-- create_group() and join_group_by_code() (20260903000000_group_membership_
-- entitlement_limit.sql) each enforce the per-user active-group entitlement
-- cap by reading "select count(*) from group_members where user_id =
-- auth.uid()" and comparing it to the tier limit, then inserting a new
-- group_members row further down — two separate statements with no lock
-- between them, the exact same TOCTOU shape already fixed once for
-- check_rate_limit() (20260902000000_rate_limit_race_fix.sql). Two
-- concurrent calls for the same user — two devices on the same account, or
-- one of each function racing itself — can both read the count *before*
-- either insert commits, so both see room under the limit and both
-- succeed, letting the stated limit be exceeded by however many callers
-- raced.
--
-- Proven against a real Postgres 16 instance before fixing: with an
-- injected delay between each function's count-check and its insert (the
-- same technique supabase/tests/rate_limit_race.test.sh already uses for
-- check_rate_limit), a free-tier user already at 1 of their 2 allowed
-- groups who fires two concurrent join_group_by_code calls for two
-- different codes ends up a member of 3 groups, not capped at 2 — and the
-- same result firing one create_group and one join_group_by_code
-- concurrently. check_rate_limit()'s own advisory lock (keyed on
-- ('create-group', user_id)) happens to incidentally serialize two
-- concurrent create_group calls against EACH OTHER, since create_group
-- calls it early and the lock is transaction-scoped — but that's a side
-- effect of a lock meant for a different purpose, not a real guard: it
-- does nothing for join_group_by_code (which never calls
-- check_rate_limit()) or for the create_group + join_group_by_code
-- cross-function case, both proven above to still race.
--
-- Fix: both functions take a pg_advisory_xact_lock keyed on the calling
-- user's id, in the same shared 'group_limit:' namespace, before reading
-- the count — whichever function gets there first blocks the other until
-- its own transaction (the whole RPC call) commits, so the second always
-- sees an up-to-date count. Transaction-scoped, so it releases
-- automatically; a different user's calls use a different key and never
-- contend with this one.
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
