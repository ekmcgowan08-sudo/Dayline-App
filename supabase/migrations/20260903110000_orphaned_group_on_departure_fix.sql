-- A gap in the same territory as Phase 50/60/63: leave_group()'s own
-- last-member-leaving path deletes the whole group in the same
-- transaction, so a sole member leaving via the app never orphans
-- anything. But account deletion reaches the exact same "this was the
-- group's last member" state through a completely different door —
-- admin.auth.admin.deleteUser() issuing `delete from auth.users`, which
-- cascades onto group_members via its own FK, firing the
-- group_members_owner_departure trigger (Phase 50) — and that trigger,
-- until now, only ever handled "other members remain, promote one of
-- them"; its documented no-op branch for "nobody left at all" assumed
-- leave_group() would always be the one reaching that state, and never
-- deleted the orphaned group.
--
-- Reproduced against a real Postgres instance, no concurrency needed at
-- all: a user creates a group, is its only member, and deletes their
-- account. The group survives (correctly, per Phase 50 — created_by is
-- ON DELETE SET NULL, not a kill switch) but with zero group_members
-- rows and its invite code still `active`. Sometime later — no race, a
-- completely ordinary join — a different user joins via that still-live
-- code and lands as a plain 'member', because join_group_by_code()
-- always inserts new joiners as 'member', never 'owner'. The result is
-- an immediately broken, unmanageable group: no owner, no admin, and no
-- RPC anywhere lets a plain member promote themselves — the exact
-- "nobody in charge" state every prior fix in this territory exists to
-- prevent, reached through a path none of them covered.
--
-- Also reproduced the race version: with the departing owner's account-
-- deletion transaction held open, a concurrent join_group_by_code() call
-- can land AFTER the group_members_owner_departure trigger's exists-
-- check already ran and saw zero members (the join hadn't committed yet
-- under READ COMMITTED), so the joiner ends up the group's only member
-- with role 'member' and nothing ever promotes them — same broken end
-- state, reached one step earlier.
--
-- Fix, in two parts:
--
-- 1. group_members_owner_departure now also acquires the same
--    'group_ownership:' pg_advisory_xact_lock every other group-
--    membership-changing function already takes (Phase 59/60/63),
--    before doing anything else. This is the piece that actually closes
--    the race: join_group_by_code() (Phase 63) takes this same lock
--    before its authoritative re-check, so whichever of "the owner's
--    account-deletion cascade" or "a concurrent join" gets there first
--    for a given group now fully resolves before the other proceeds.
--    If the join wins, the trigger's later exists-check correctly sees
--    the new member (now durably committed) and promotes them to owner
--    — a strictly better outcome than before, not just a safe one. If
--    the departure wins, the join's authoritative re-check afterward
--    correctly finds the group gone and returns invalid_or_expired_code
--    instead of a silent, inconsistent success.
-- 2. Its previously-no-op "nobody left in this group at all" branch now
--    deletes the group, exactly mirroring what leave_group()'s own
--    last-member-leaving branch already does — the only other place
--    this state can arise, and it should mean the same thing wherever
--    it happens. leave_group() itself is simplified to lean on this:
--    it no longer deletes the group directly (the trigger, fired by its
--    own `delete from group_members` a few lines up, already did it by
--    the time control returns), and skips its own group_membership_
--    events 'left' insert in exactly that case — that event would
--    either be immediately cascade-deleted along with the group anyway
--    (moot) or, now that the group may already be gone by the time this
--    statement runs, fail its own foreign key check.
create or replace function reassign_group_owner_on_departure() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_owner uuid;
begin
  if old.role = 'owner' then
    perform pg_advisory_xact_lock(hashtextextended('group_ownership:' || old.group_id::text, 0));
    if exists (select 1 from group_members where group_id = old.group_id) then
      if not exists (select 1 from group_members where group_id = old.group_id and role in ('owner', 'admin')) then
        select user_id into v_new_owner
        from group_members
        where group_id = old.group_id
        order by (role = 'admin') desc, joined_at asc
        limit 1;

        if v_new_owner is not null then
          update group_members set role = 'owner' where group_id = old.group_id and user_id = v_new_owner;
          insert into group_membership_events (group_id, user_id, actor_id, event)
            values (old.group_id, v_new_owner, v_new_owner, 'role_changed');
        end if;
      end if;
    else
      -- This owner's departure left the group with nobody in it at all
      -- — the same state leave_group()'s own last-member-leaving branch
      -- handles by deleting the group; do the same here so every path
      -- that can empty a group cleans it up the same way, rather than
      -- leaving a permanently orphaned row with a still-live invite
      -- code for someone to stumble into later.
      delete from groups where id = old.group_id;
    end if;
  end if;
  return old;
end;
$$;

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
  -- When this was the group's last member, the group_members_owner_
  -- departure trigger fired by the delete above already deleted the
  -- whole group (see that function) — recording a 'left' event for it
  -- would be moot at best and a foreign key violation at worst, so this
  -- is skipped in precisely that case.
  if not (v_role = 'owner' and v_member_count <= 1) then
    insert into group_membership_events (group_id, user_id, actor_id, event) values (p_group_id, auth.uid(), auth.uid(), 'left');
  end if;
end;
$$;
revoke all on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;
