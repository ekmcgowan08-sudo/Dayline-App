-- transfer_group_ownership() (fixed for its own same-function race in
-- 20260903060000_transfer_ownership_race_fix.sql, Phase 59) can still
-- race against remove_group_member(), a function that never contends
-- for that fix's advisory lock at all. transfer_group_ownership() reads
-- the target's current role, and only if the target still exists does it
-- go on to demote the caller to 'admin' and promote the target to
-- 'owner' — two separate statements. If remove_group_member() deletes
-- that exact target in the gap between the read and those two writes,
-- the promotion silently affects zero rows (an UPDATE matching no rows
-- is not an error in Postgres) while the demotion still lands, leaving
-- the group with the original owner correctly stepped down to 'admin'
-- but nobody promoted to take their place: zero owners.
--
-- This is not the same gap Phase 50's `group_members_owner_departure`
-- trigger closes — that trigger only fires `after delete on
-- group_members` `when old.role = 'owner'`, and here the owner's row is
-- *updated* to 'admin', never deleted, so it never fires. A group left
-- with zero owners this way is stuck exactly like Phase 50's Bug 2:
-- transfer_group_ownership(), set_group_member_role(), and
-- delete_group() all require an existing owner, so nobody can ever
-- manage or delete the group again.
--
-- Proven against a real Postgres 16 instance before fixing: a group
-- with an owner, an admin, and a plain member, with a delay injected
-- into transfer_group_ownership() between its target-existence check
-- and its actual role updates. Fired transfer_group_ownership(owner ->
-- member) concurrently with remove_group_member(admin removing that
-- same member). Both calls succeeded. Final state: the original owner
-- correctly demoted to 'admin', the target correctly removed, but
-- nobody promoted to 'owner' — zero owner rows left in the group.
--
-- Fix: remove_group_member() now takes the same 'group_ownership:'
-- advisory lock transfer_group_ownership() already uses, keyed on the
-- group id. Whichever function gets there first for a given group runs
-- to completion (and releases the lock) before the other proceeds, so
-- each function's own existing checks see up-to-date data: if the
-- transfer commits first, the target is already 'owner' by the time
-- remove_group_member() re-reads their role, and its own
-- cannot_remove_owner guard correctly refuses to remove them; if the
-- removal commits first, the target is already gone by the time
-- transfer_group_ownership() re-reads them, and its own not_a_member
-- guard correctly refuses the transfer without ever touching the
-- caller's role.
create or replace function remove_group_member(p_group_id uuid, p_target_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target_role text;
begin
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'not_authorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || p_group_id::text, 0));

  select role into v_target_role from group_members where group_id = p_group_id and user_id = p_target_user_id;
  if v_target_role is null then
    raise exception 'not_a_member';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;
  delete from group_members where group_id = p_group_id and user_id = p_target_user_id;
  insert into group_membership_events (group_id, user_id, actor_id, event) values (p_group_id, p_target_user_id, auth.uid(), 'removed');
end;
$$;
revoke all on function remove_group_member(uuid, uuid) from public;
grant execute on function remove_group_member(uuid, uuid) to authenticated;
