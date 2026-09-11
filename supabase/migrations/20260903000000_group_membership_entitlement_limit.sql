-- create_group() and join_group_by_code() are the only two paths that add
-- a group_members row for the calling user, and neither ever checked the
-- caller's *total* active group count against their entitlement tier.
-- ENTITLEMENT_LIMITS.free/plus.maxActiveGroups (mobile/src/constants/
-- entitlements.ts) existed only as a client-side UI hint — the "Create
-- group"/"Join with code" buttons on groups/index.tsx disable once the
-- client-fetched group list reaches the limit, but nothing stopped a
-- direct RPC call (or a modified client) from creating or joining
-- unlimited groups regardless of tier. Same missing-server-enforcement
-- bug class already fixed once for the memory archive
-- (20260831180000_entitlement_enforced_archive.sql) but missed here —
-- reproduced against a real Postgres instance: a fresh 'free' user (no
-- subscription row) created 4 groups in a row with no error.
--
-- The counts below (2 free / 10 plus) must be kept in sync by hand with
-- ENTITLEMENT_LIMITS.free/plus.maxActiveGroups in
-- mobile/src/constants/entitlements.ts — no shared source of truth
-- between Postgres and the TS bundle in this build; both sides carry a
-- comment pointing at the other on purpose, so this doesn't silently
-- drift.

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
