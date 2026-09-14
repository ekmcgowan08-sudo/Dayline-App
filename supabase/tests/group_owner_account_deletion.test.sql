-- Proves 20260903020000_groups_created_by_set_null.sql and
-- 20260903030000_group_members_owner_reassignment.sql together close the
-- account-deletion group-orphaning gap in docs/IMPLEMENTATION_STATUS.md
-- Phase 50: reproduced against a real Postgres instance first (deleting
-- a group founder's account — even one who had already transferred
-- ownership away and left the group entirely — destroyed the whole
-- group via groups.created_by's ON DELETE CASCADE; deleting a group's
-- current sole owner's account left the survivors with no owner/admin
-- and no path to ever get one back).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('44444444-5555-0000-0000-000000000001', 'gd-founder@test.dayline.app'),
  ('44444444-5555-0000-0000-000000000002', 'gd-newowner@test.dayline.app'),
  ('44444444-5555-0000-0000-000000000003', 'gd-owner2@test.dayline.app'),
  ('44444444-5555-0000-0000-000000000004', 'gd-m1@test.dayline.app'),
  ('44444444-5555-0000-0000-000000000005', 'gd-m2@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('44444444-5555-0000-0000-000000000001', 'gd-founder'),
  ('44444444-5555-0000-0000-000000000002', 'gd-newowner'),
  ('44444444-5555-0000-0000-000000000003', 'gd-owner2'),
  ('44444444-5555-0000-0000-000000000004', 'gd-m1'),
  ('44444444-5555-0000-0000-000000000005', 'gd-m2')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

-- ---------------------------------------------------------------------
-- Scenario A: a founder who transferred ownership away and left the
-- group entirely (not even a member anymore) later deletes their
-- account. The group and the real current owner's membership must both
-- survive — created_by is historical trivia, not a kill switch.
-- ---------------------------------------------------------------------
set role authenticated;
select test_login('44444444-5555-0000-0000-000000000001');
select g.id as group_a_id, g.invite_code as code_a from create_group('Scenario A Group') g \gset

select test_login('44444444-5555-0000-0000-000000000002');
select join_group_by_code(:'code_a');

select test_login('44444444-5555-0000-0000-000000000001');
select transfer_group_ownership(:'group_a_id'::uuid, '44444444-5555-0000-0000-000000000002'::uuid);
select leave_group(:'group_a_id'::uuid);
reset role;

delete from auth.users where id = '44444444-5555-0000-0000-000000000001';

do $$
declare v_n int;
begin
  select count(*) into v_n from groups where name = 'Scenario A Group';
  if v_n <> 1 then raise exception 'FAIL: Scenario A group was destroyed by the departed founder''s account deletion'; end if;
end $$;

do $$
declare v_role text;
begin
  select role into v_role from group_members
    where group_id = (select id from groups where name = 'Scenario A Group')
      and user_id = '44444444-5555-0000-0000-000000000002';
  if v_role is distinct from 'owner' then
    raise exception 'FAIL: the real current owner lost their membership/role after the departed founder deleted their account, got %', v_role;
  end if;
  raise notice 'PASS: group and current owner survive a departed founder''s account deletion';
end $$;

-- ---------------------------------------------------------------------
-- Scenario B: the group's actual current sole owner deletes their
-- account while other members remain. The group must survive (Scenario
-- A's fix) AND be left with someone able to manage it (this fix) —
-- the earliest-joined remaining member auto-promoted to owner.
-- ---------------------------------------------------------------------
set role authenticated;
select test_login('44444444-5555-0000-0000-000000000003');
select g.id as group_b_id, g.invite_code as code_b from create_group('Scenario B Group') g \gset

select test_login('44444444-5555-0000-0000-000000000004');
select join_group_by_code(:'code_b');

select test_login('44444444-5555-0000-0000-000000000005');
select join_group_by_code(:'code_b');
reset role;

delete from auth.users where id = '44444444-5555-0000-0000-000000000003';

do $$
declare v_owner_count int; v_new_owner uuid;
begin
  select count(*) into v_owner_count from group_members
    where group_id = (select id from groups where name = 'Scenario B Group') and role = 'owner';
  if v_owner_count <> 1 then
    raise exception 'FAIL: expected exactly 1 owner after reassignment, got %', v_owner_count;
  end if;
  select user_id into v_new_owner from group_members
    where group_id = (select id from groups where name = 'Scenario B Group') and role = 'owner';
  if v_new_owner <> '44444444-5555-0000-0000-000000000004' then
    raise exception 'FAIL: expected the earliest-joined remaining member (gd-m1) promoted, got %', v_new_owner;
  end if;
  raise notice 'PASS: the earliest-joined remaining member is auto-promoted to owner';
end $$;

-- The new owner must actually be able to exercise owner powers now.
set role authenticated;
select test_login('44444444-5555-0000-0000-000000000004');
do $$
declare v_result jsonb;
begin
  select set_group_member_role(
    (select id from groups where name = 'Scenario B Group'),
    '44444444-5555-0000-0000-000000000005'::uuid,
    'admin'
  ) into v_result;
  if not (v_result->>'ok')::boolean then
    raise exception 'FAIL: the auto-promoted owner could not exercise owner powers: %', v_result->>'error';
  end if;
  raise notice 'PASS: the auto-promoted owner can actually manage the group again';
end $$;
reset role;

select 'ALL GROUP OWNER ACCOUNT DELETION TESTS PASSED' as result;
