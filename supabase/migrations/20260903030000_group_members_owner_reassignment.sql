-- Closes the other half of the account-deletion group-orphaning gap
-- fixed alongside this in 20260903020000_groups_created_by_set_null.sql.
-- That migration stopped account deletion from destroying the whole
-- group; it doesn't stop a group from being left with zero
-- owner/admin members when the deleted account was the group's sole
-- owner. Every app-level path that removes an owner's group_members row
-- already guards this: leave_group() refuses an owner with other
-- members present ('owner_must_transfer_or_delete'), and
-- remove_group_member() refuses to remove an owner at all
-- ('cannot_remove_owner'). The ONLY way an owner's row disappears while
-- other members remain is the auth.users -> group_members ON DELETE
-- CASCADE firing directly from account deletion, which goes around all
-- of those RPCs entirely.
--
-- Reproduced against a real local Postgres instance: a group with an
-- owner and two plain members, the owner deletes their account, the
-- group survives (per the other fix) but is left with zero owner/admin
-- rows — nobody can ever call set_group_member_role(),
-- transfer_group_ownership(), or delete_group() again (all three
-- require an existing owner), and if the last remaining member later
-- leaves via leave_group(), that function's own last-member-leaving
-- auto-delete only fires for role='owner' (never true for them), so
-- the group row would be left permanently orphaned with zero members
-- and no path to clean it up.
--
-- Fixed with a trigger that only ever fires in exactly this gap: an
-- owner row is deleted (by any means) while other members remain, and
-- the group currently has no other owner/admin. It promotes the
-- longest-tenured admin, or if none, the longest-tenured plain member,
-- to owner — the same "someone must be in charge" outcome a person
-- would reach for by hand via transfer_group_ownership() if they still
-- could. A no-op when there's no one left (the leave_group()
-- last-member-leaving case, which deletes the whole group right after
-- in the same transaction anyway) or when an owner/admin already
-- exists (every legitimate app-level path).

create or replace function reassign_group_owner_on_departure() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_owner uuid;
begin
  if old.role = 'owner' then
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
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists group_members_owner_departure on group_members;
create trigger group_members_owner_departure
  after delete on group_members
  for each row
  execute function reassign_group_owner_on_departure();
