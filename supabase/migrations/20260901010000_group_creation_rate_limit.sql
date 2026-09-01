-- create_group() was the last group-membership write path with no rate
-- limit — join attempts (S5), reports, montage requests, account
-- deletion, transcription, and comment/reaction posting all already use
-- check_rate_limit(). An unrestricted authenticated user could otherwise
-- create unbounded groups (each with its own invite code, membership
-- row, and membership-event log entry).
--
-- The check runs first, before any row is written, so raising on
-- rejection can't roll back real work the way it would if placed after
-- the insert loop — same reasoning as every other raise-exception-style
-- validation already in this function (not_authenticated,
-- group_name_required).
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
