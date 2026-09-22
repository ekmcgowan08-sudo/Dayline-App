-- moderator_suspend_user() (20260831030000_moderation_and_blocks.sql) sets
-- profiles.account_status = 'suspended', logs the action, and returns --
-- but nothing anywhere in this codebase ever reads account_status again.
-- No RLS policy, no Edge Function, no client code checks it. docs/
-- MODERATION_RUNBOOK.md explicitly instructs moderators to suspend an
-- account for a "serious/repeat violation," and — more seriously — to
-- "suspend the account immediately" for illegal content (CSAM, credible
-- threats) as the one concrete, immediate safety action the runbook
-- names before legal reporting obligations take over. A suspended
-- account is, today, purely a label: the user can keep capturing clips,
-- posting comments and reactions, and creating or joining groups,
-- completely unaffected.
--
-- Confirmed against a real Postgres 16 instance before fixing: created a
-- user, suspended them via the actual moderator_suspend_user() RPC (using
-- the runbook's own example reason, "CSAM report"), then — still logged
-- in as that same suspended user — successfully inserted a new clip row
-- directly (the same write path the mobile app's capture flow uses) and
-- successfully called create_group() to create a brand-new group. Both
-- succeeded with no error, no rejection, nothing.
--
-- Fix: enforce account_status at the two places new content/reach are
-- actually created — RLS WITH CHECK for direct table inserts (clips,
-- comments, reactions), and an explicit check inside the SECURITY
-- DEFINER RPCs that create or extend group membership (create_group,
-- join_group_by_code, contribute_clip_to_group) — those run with the
-- function owner's privileges and bypass RLS entirely, so an RLS change
-- alone would not have covered them. Deliberately NOT touched: SELECT
-- access to a user's own existing content, DELETE of their own rows
-- (clips, comments), delete-account, and data export — a suspended user
-- must still be able to see what they already posted, delete it, and
-- delete or export their own account; suspension blocks creating and
-- spreading more, not access to your own existing data. Also
-- deliberately not extended to group role-management RPCs (transfer_
-- group_ownership, set_group_member_role, remove_group_member) or to
-- reading/downloading already-rendered content (get-montage-url,
-- get-export-url) — narrower judgment calls left for a follow-up rather
-- than broadened here without the same real-infra verification this fix
-- itself required.
create or replace function is_account_suspended() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select account_status = 'suspended' from profiles where id = auth.uid()),
    false
  );
$$;
revoke all on function is_account_suspended() from public;
grant execute on function is_account_suspended() to authenticated;

-- clips: was a single `for all using (...)` policy with no explicit
-- WITH CHECK, so Postgres reused USING (just ownership) for INSERT too.
-- Splitting the WITH CHECK out lets SELECT/UPDATE/DELETE on a suspended
-- user's own existing clips stay exactly as before, while INSERT (a new
-- capture) now also requires an active account.
drop policy if exists "own clips" on clips;
create policy "own clips" on clips for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and not is_account_suspended());

drop policy if exists "insert own comment on visible montages" on comments;
create policy "insert own comment on visible montages" on comments for insert with check (
  auth.uid() = user_id
  and not is_account_suspended()
  and length(trim(body)) > 0
  and length(body) <= 500
  and montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
  and check_rate_limit('comment-post', auth.uid()::text, 20, 300)
);

drop policy if exists "insert own reaction on visible montages" on reactions;
create policy "insert own reaction on visible montages" on reactions for insert with check (
  auth.uid() = user_id
  and not is_account_suspended()
  and montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
  and check_rate_limit('reaction-post', auth.uid()::text, 30, 300)
);

create or replace function create_group(p_name text, p_timezone text default 'UTC') returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_group groups;
  v_attempts int := 0;
  v_tz text := 'UTC';
  v_group_limit int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if is_account_suspended() then
    raise exception 'account_suspended';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'group_name_required';
  end if;
  if not check_rate_limit('create-group', auth.uid()::text, 5, 3600) then
    raise exception 'rate_limited';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group_limit:' || auth.uid()::text, 0));

  v_group_limit := case when current_entitlement() = 'plus' then 10 else 2 end;
  if (select count(*) from group_members where user_id = auth.uid()) >= v_group_limit then
    raise exception 'group_limit_reached';
  end if;

  if p_timezone is not null then
    begin
      perform (now() at time zone p_timezone);
      v_tz := p_timezone;
    exception when others then
      v_tz := 'UTC';
    end;
  end if;

  loop
    v_code := generate_invite_code();
    begin
      insert into groups (name, created_by, invite_code, max_members, timezone)
      values (trim(p_name), auth.uid(), v_code, 10, v_tz)
      returning * into v_group;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 10 then
        raise exception 'invite_code_collision_retry_exceeded';
      end if;
    end;
  end loop;

  insert into group_members (group_id, user_id, role) values (v_group.id, auth.uid(), 'owner');
  insert into group_membership_events (group_id, user_id, actor_id, event) values (v_group.id, auth.uid(), auth.uid(), 'joined');
  return v_group;
end;
$$;
revoke all on function create_group(text, text) from public;
grant execute on function create_group(text, text) to authenticated;

create or replace function join_group_by_code(p_code text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
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

  select * into v_group from groups
  where invite_code = v_normalized_code
    and invite_code_status = 'active'
    and (invite_code_expires_at is null or invite_code_expires_at > now())
  for update;

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

create or replace function contribute_clip_to_group(p_clip_id uuid, p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_account_suspended() then
    raise exception 'account_suspended';
  end if;
  if not exists (select 1 from clips where id = p_clip_id and user_id = auth.uid()) then
    raise exception 'not_your_clip';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  insert into group_contributions (clip_id, group_id, contributed_by)
  values (p_clip_id, p_group_id, auth.uid())
  on conflict (clip_id, group_id) do nothing;
end;
$$;
revoke all on function contribute_clip_to_group(uuid, uuid) from public;
grant execute on function contribute_clip_to_group(uuid, uuid) to authenticated;
