-- TOCTOU race #7 found this session, in a function none of the prior six
-- fixes touched: leave_group(). When the caller is a group's sole
-- remaining member, it reads the current member count, and only much
-- later — after deleting the caller's own group_members row, inserting a
-- group_membership_events row, and firing the group_members_owner_
-- departure trigger — acts on that count by deleting the entire group.
-- Nothing re-verifies the count is still accurate right before that
-- delete, and nothing stops join_group_by_code() from adding a brand
-- new member to the same group in the gap between the read and the
-- delete.
--
-- Proven against a real Postgres 16 instance before fixing: a sole owner
-- of a group, with a delay injected immediately after leave_group()'s
-- member-count read, calls leave_group() while a second user
-- concurrently calls join_group_by_code() with that group's still-active
-- invite code. join_group_by_code() runs to completion and returns
-- {"ok": true, "group": {...}} — by every signal the API gives that
-- caller, they are now a member of a real group. leave_group() then
-- resumes with its stale pre-join count of 1, sees "owner, count <= 1",
-- and deletes the entire groups row, cascading away the second user's
-- just-committed group_members row along with it. The joiner is told
-- they joined a group that, moments later, silently no longer exists —
-- no error, no signal, just a group and a membership that both vanish.
--
-- (Also empirically ruled out a different, narrower interleaving: when
-- leave_group() reaches its own insert into group_membership_events
-- before a concurrent joiner's `select ... for update` on the groups
-- row, that insert's incidental foreign-key lock on the parent groups
-- row happens to block the joiner until leave_group()'s transaction
-- fully commits or rolls back — so that particular ordering was already
-- accidentally safe. The count-read-then-much-later-act ordering above
-- is not, and this fix does not rely on that FK-lock coincidence
-- either way.)
--
-- Fix: same 'group_ownership:' pg_advisory_xact_lock transfer_group_
-- ownership() and remove_group_member() already take (Phase 59/60) —
-- leave_group() now acquires it right after confirming the caller is a
-- member, before reading the member count that drives its
-- delete-the-group decision. join_group_by_code() now acquires the same
-- lock, keyed on the group id resolved from the invite code, before
-- doing any authoritative check or write against that group — replacing
-- its previous `for update` row lock, which only ever protected it
-- against other join_group_by_code() calls, never against leave_group()/
-- transfer_group_ownership()/remove_group_member(). Whichever function
-- gets to a given group's lock first now runs to completion (commit or
-- rollback) before the other proceeds, and the other always re-reads
-- fully up-to-date state afterward — no more stale in-memory counts
-- driving a destructive decision.
--
-- Lock ordering: join_group_by_code() acquires 'invite_attempts:'
-- (Phase 61), then resolves the group id with a plain, unlocked lookup
-- (deliberately not `for update` — taking any row lock on `groups`
-- before the advisory lock would let it hold that row lock while
-- blocked waiting on 'group_ownership:', while leave_group() could
-- simultaneously hold 'group_ownership:' while blocked on that same row
-- lock via its own later `delete from groups` — a classic AB-BA
-- deadlock), then 'group_ownership:', then 'group_limit:'. leave_group()
-- only ever acquires 'group_ownership:'. transfer_group_ownership()/
-- remove_group_member() are unchanged and still only acquire
-- 'group_ownership:'. No function acquires 'group_ownership:' after
-- already holding a row lock on `groups`, so this ordering can't
-- deadlock against itself or the other three.
create or replace function leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_member_count int;
begin
  select role into v_role from group_members where group_id = p_group_id and user_id = auth.uid();
  if v_role is null then
    raise exception 'not_a_member';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || p_group_id::text, 0));

  select count(*) into v_member_count from group_members where group_id = p_group_id;

  if v_role = 'owner' and v_member_count > 1 then
    raise exception 'owner_must_transfer_or_delete';
  end if;

  delete from group_members where group_id = p_group_id and user_id = auth.uid();
  insert into group_membership_events (group_id, user_id, actor_id, event) values (p_group_id, auth.uid(), auth.uid(), 'left');

  if v_role = 'owner' and v_member_count <= 1 then
    delete from groups where id = p_group_id; -- last member leaving deletes the group; cascades montages/contributions
  end if;
end;
$$;
revoke all on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;

create or replace function join_group_by_code(p_code text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_group_id uuid;
  v_recent_attempts int;
  v_member_count int;
  v_group_limit int;
  v_normalized_code text := upper(trim(p_code));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if is_account_suspended() then
    return jsonb_build_object('ok', false, 'error', 'account_suspended');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('invite_attempts:' || auth.uid()::text, 0));

  select count(*) into v_recent_attempts
  from invite_code_attempts
  where user_id = auth.uid() and created_at > now() - interval '10 minutes';

  if v_recent_attempts >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  -- Non-authoritative: just learns which group this code currently names,
  -- so the lock below can be taken before touching anything else about
  -- it. Deliberately not `for update` — see the migration header.
  select id into v_group_id from groups where invite_code = v_normalized_code;

  if v_group_id is null then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired_code');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || v_group_id::text, 0));

  -- Authoritative re-check, now that this group's ownership/membership
  -- lock is held: the code's status/expiry, or the group's existence
  -- itself, may have changed while this call was waiting for the lock.
  select * into v_group from groups
  where id = v_group_id
    and invite_code = v_normalized_code
    and invite_code_status = 'active'
    and (invite_code_expires_at is null or invite_code_expires_at > now());

  if not found then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired_code');
  end if;

  if exists (select 1 from group_members where group_id = v_group.id and user_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'group', to_jsonb(v_group)); -- already a member: idempotent success
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group_limit:' || auth.uid()::text, 0));

  v_group_limit := case when current_entitlement() = 'plus' then 10 else 2 end;
  if (select count(*) from group_members where user_id = auth.uid()) >= v_group_limit then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'group_limit_reached');
  end if;

  if group_has_block_with(v_group.id, auth.uid()) then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'blocked_relationship');
  end if;

  select count(*) into v_member_count from group_members where group_id = v_group.id;
  if v_member_count >= v_group.max_members then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'group_full');
  end if;

  insert into group_members (group_id, user_id, role) values (v_group.id, auth.uid(), 'member');
  insert into group_membership_events (group_id, user_id, actor_id, event) values (v_group.id, auth.uid(), auth.uid(), 'joined');
  insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, true);
  return jsonb_build_object('ok', true, 'group', to_jsonb(v_group));
end;
$$;
revoke all on function join_group_by_code(text) from public;
grant execute on function join_group_by_code(text) to authenticated;
