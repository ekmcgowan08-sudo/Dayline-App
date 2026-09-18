-- join_group_by_code()'s invite-code brute-force guard has its own
-- ad-hoc rate limiter (a hand-rolled count against invite_code_attempts,
-- predating check_rate_limit() and never migrated onto it) with the
-- exact same TOCTOU shape check_rate_limit() had before Phase 38: it
-- reads how many attempts this user made in the last 10 minutes,
-- compares that to 20, and only *then* inserts a new attempt row --
-- two separate statements, no lock between them.
--
-- Proven against a real Postgres 16 instance before fixing: with a
-- delay injected between the count check and the rest of the function
-- (matching the natural gap that already exists before the invite-code
-- lookup and its own insert), fired 25 concurrent join_group_by_code()
-- calls with an invalid code for the same user. All 25 came back
-- `invalid_or_expired_code` (meaning all 25 passed the rate check) —
-- none were rejected as `rate_limited`, and 25 rows landed in
-- invite_code_attempts, five over the stated 20-per-10-minutes limit.
-- This guard exists specifically to slow down someone guessing a
-- private group's invite code; bypassing it via concurrency means an
-- attacker firing requests in parallel faces no meaningful rate limit
-- at all.
--
-- Fix: same pattern as every other fix in this session's TOCTOU class
-- (check_rate_limit itself, the group-count limit, transfer_group_
-- ownership, remove_group_member) — a pg_advisory_xact_lock keyed on
-- the calling user's id, taken before the count read. Acquired first,
-- before the group-limit lock further down in this same function
-- (Phase 56), so the two locks are always taken in the same order by
-- every caller and can't deadlock against each other.
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
