-- Per-group timezone for group ("Our Day") montage day-boundary
-- calculation. Previously hardcoded to a plain UTC calendar day in
-- worker/src/render/fetchEligibleClips.ts because there's no single
-- canonical timezone for a group of people — this migration makes that a
-- real, owner/admin-settable per-group choice instead (defaulting to UTC,
-- same effective behavior as before for any group that never sets one).
-- See docs/DECISIONS.md.

alter table groups add column if not exists timezone text not null default 'UTC';

-- ---------------------------------------------------------------------
-- Close a latent gap found while adding this: the pre-existing "owner or
-- admin update group" RLS policy (20260831020000_groups_hardening.sql)
-- allows an UPDATE on the whole `groups` row, with no WITH CHECK and no
-- column restriction — an owner/admin could PATCH invite_code,
-- max_members, or created_by directly via PostgREST, none of which any
-- client flow is meant to touch outside the dedicated SECURITY DEFINER
-- RPCs (create_group, rotate_invite_code/regenerate_invite_code,
-- revoke_invite_code). No client code exercises the raw policy today
-- (there's no "rename group" feature either), so nothing observable
-- changes for the app — but leaving a broad raw-UPDATE grant in place
-- while adding a brand-new settable column (timezone) is exactly the kind
-- of moment that gap should be closed, not carried forward. Every group
-- mutation now goes through a dedicated, validated RPC; the raw table
-- UPDATE path for `authenticated` is removed entirely.
-- ---------------------------------------------------------------------
drop policy if exists "owner or admin update group" on groups;
revoke update on groups from authenticated;

-- ---------------------------------------------------------------------
-- set_group_timezone: owner/admin only, validated. Postgres itself is the
-- IANA timezone database here — `now() at time zone p_timezone` raises for
-- any name Postgres doesn't recognize, so this is real validation, not a
-- format regex hoping to approximate one. Returns jsonb ({"ok": ...}) per
-- this file's established pattern (see join_group_by_code's comment for
-- why expected-failure paths return rather than raise).
-- ---------------------------------------------------------------------
create or replace function set_group_timezone(p_group_id uuid, p_timezone text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner_or_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select exists(
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid() and role in ('owner', 'admin')
  ) into v_is_owner_or_admin;

  if not v_is_owner_or_admin then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  begin
    perform (now() at time zone p_timezone);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_timezone');
  end;

  update groups set timezone = p_timezone, updated_at = now() where id = p_group_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function set_group_timezone(uuid, text) from public;
grant execute on function set_group_timezone(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- create_group gains an optional timezone (defaults to 'UTC' for any
-- existing caller that doesn't pass one — additive, non-breaking). Same
-- validate-via-Postgres approach as set_group_timezone; an invalid value
-- silently falls back to 'UTC' at creation time rather than failing group
-- creation over it (unlike set_group_timezone's explicit rejection, which
-- is a deliberate user action worth surfacing an error for).
-- ---------------------------------------------------------------------
-- PostgREST resolves RPC calls by name and doesn't handle overloaded
-- functions well (an ambiguous-candidate error if both signatures exist
-- simultaneously) — drop the old single-argument signature explicitly
-- rather than leaving it alongside the new one.
drop function if exists create_group(text);

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
