-- Owner can promote a member to admin or demote an admin back to member.
-- Closes the ROADMAP.md Milestone 4 gap — "admin-role UI refinements" —
-- which turned out to be more than a UI gap once actually checked: the
-- schema has always distinguished owner/admin/member (and
-- group_membership_events' own check constraint already anticipated a
-- 'role_changed' event), but no function ever existed to actually GRANT
-- admin. Every member past the group's founding owner could only ever
-- join as plain 'member' — there was no admin tier to differentiate a
-- UI for yet.
--
-- Deliberately owner-only (not owner-or-admin, unlike regenerate_invite_
-- code/revoke_invite_code/remove_group_member/set_group_timezone above):
-- letting admins promote other members to admin would let admin status
-- proliferate without the person who actually created the group ever
-- approving it, which defeats the point of having two distinct tiers at
-- all. See docs/DECISIONS.md.

create or replace function set_group_member_role(p_group_id uuid, p_target_user_id uuid, p_role text) returns jsonb
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

  if p_role not in ('admin', 'member') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;

  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid() and role = 'owner') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select role into v_target_role from group_members where group_id = p_group_id and user_id = p_target_user_id;
  if v_target_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  -- The caller is the owner (checked above) and the owner's own row has
  -- role = 'owner', so this also covers "can't change your own role"
  -- without a separate self-check.
  if v_target_role = 'owner' then
    return jsonb_build_object('ok', false, 'error', 'cannot_change_owner_role');
  end if;

  if v_target_role = p_role then
    return jsonb_build_object('ok', true); -- no-op, not an error
  end if;

  update group_members set role = p_role where group_id = p_group_id and user_id = p_target_user_id;
  insert into group_membership_events (group_id, user_id, actor_id, event)
    values (p_group_id, p_target_user_id, auth.uid(), 'role_changed');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function set_group_member_role(uuid, uuid, text) from public;
grant execute on function set_group_member_role(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- transfer_group_ownership: found while building the function above —
-- leave_group() has always refused an owner who isn't the group's last
-- member ('owner_must_transfer_or_delete'), but no function existed to
-- actually perform that transfer. Until now, an owner of a group with
-- other people still in it had exactly one way out: delete the whole
-- group for everyone. This closes that dead end.
--
-- The outgoing owner becomes 'admin', not 'member' — they presumably
-- still care about the group enough to have kept it running; dropping
-- them to a plain member on top of losing ownership felt like a
-- needless second demotion. Logged as two separate 'role_changed'
-- events (one per affected user), same granularity as every other role
-- change in this file.
-- ---------------------------------------------------------------------
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
