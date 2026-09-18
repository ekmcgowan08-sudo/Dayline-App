-- transfer_group_ownership() (20260831230000_group_role_management.sql)
-- checks the caller currently holds role = 'owner', then performs two
-- writes further down (demote the caller to 'admin', promote the target
-- to 'owner') -- a read-then-write with no lock between, the same TOCTOU
-- shape already fixed three times this session for check_rate_limit()
-- (Phase 38), the group-count limit (Phase 56), and revenuecat-webhook
-- (Phase 58). Nothing in the schema enforces at most one 'owner' row per
-- group (group_members_role_check only constrains the column's allowed
-- values, not how many rows can hold each one), so two concurrent
-- transfer calls by the same owner to two different targets can both
-- pass the "is owner" check before either commits, and both succeed.
--
-- Proven against a real Postgres 16 instance before fixing: a group with
-- an owner and two plain members, fired two concurrent
-- transfer_group_ownership() calls from the owner to the two different
-- members (with an injected delay between the read and the writes to
-- force overlap). Both calls returned {"ok": true}. Final state: the
-- original owner correctly demoted to 'admin', but BOTH targets promoted
-- to 'owner' -- a group left with two owners, violating the single-
-- owner invariant every other piece of group-management code assumes
-- (the migration that introduced this function is explicit that the
-- outgoing owner becoming 'admin' was meant to close the "no way out"
-- gap for good, not leave a new one).
--
-- Fix: take a pg_advisory_xact_lock keyed on the group id before the
-- authorization check, serializing concurrent ownership transfers for
-- the same group -- whichever caller gets there first blocks the other
-- until its transaction commits, so the second caller's own "is owner"
-- check then correctly sees the first caller's completed transfer and
-- fails with not_authorized (no longer the group's owner) instead of
-- racing past it. set_group_member_role() never touches the 'owner'
-- role (it only ever grants 'admin'/'member' and refuses to change an
-- existing owner's role), so it can't create a second owner and doesn't
-- need this lock.
create or replace function transfer_group_ownership(p_group_id uuid, p_new_owner_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || p_group_id::text, 0));

  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid() and role = 'owner') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if p_new_owner_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'already_owner');
  end if;

  select role into v_target_role from group_members where group_id = p_group_id and user_id = p_new_owner_id;
  if v_target_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  update group_members set role = 'admin' where group_id = p_group_id and user_id = auth.uid();
  update group_members set role = 'owner' where group_id = p_group_id and user_id = p_new_owner_id;

  insert into group_membership_events (group_id, user_id, actor_id, event) values (p_group_id, auth.uid(), auth.uid(), 'role_changed');
  insert into group_membership_events (group_id, user_id, actor_id, event) values (p_group_id, p_new_owner_id, auth.uid(), 'role_changed');

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function transfer_group_ownership(uuid, uuid) from public;
grant execute on function transfer_group_ownership(uuid, uuid) to authenticated;
