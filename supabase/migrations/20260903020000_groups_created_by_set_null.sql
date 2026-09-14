-- groups.created_by has been `on delete cascade` to auth.users since the
-- original schema — meaning it isn't just an attribution field, it's a
-- silent kill switch: deleting the account that happened to found a
-- group deletes the ENTIRE group for everyone else in it (group_members,
-- montages, group_contributions, group_membership_events all cascade
-- from groups.id in turn), with zero warning to anyone still in it.
--
-- This isn't hypothetical or edge-case-only: it fires even after
-- ownership has been legitimately transferred away via
-- transfer_group_ownership() and the founder has left the group
-- entirely via leave_group() — at that point they are not a member,
-- not the owner, and have no relationship to the group's current state
-- at all, yet deleting their own account still destroys it for the
-- actual current owner and every other member. Reproduced against a
-- real local Postgres instance: create a group, transfer ownership,
-- have the founder leave, delete the founder's account — the group and
-- the new owner's membership both vanish.
--
-- created_by is purely historical attribution (who happened to run
-- create_group()) and is never used for authorization anywhere — every
-- RLS policy and RPC that gates group management already switched to
-- checking group_members.role ("owner or admin update group",
-- set_group_member_role, transfer_group_ownership, delete_group) rather
-- than created_by; the "creator manages group" policy that once read it
-- was replaced by that switch (see 20260831020000_groups_hardening.sql).
-- Nothing in the mobile client displays or reads groups.created_by
-- either. So ON DELETE SET NULL is safe: it keeps the group and its
-- membership intact and merely loses a piece of historical trivia
-- nobody reads.

alter table groups alter column created_by drop not null;
alter table groups drop constraint groups_created_by_fkey;
alter table groups add constraint groups_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
