-- Proves set_group_member_role() is genuinely owner-only, validates its
-- inputs server-side, and can't be used to touch the owner's own role —
-- the actual enforcement behind the "admin-role" distinction the schema
-- has always had but, until this migration, no function could ever grant.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('bbbbbbbb-2222-2222-2222-222222222201', 'role-owner@test.dayline.app'),
  ('bbbbbbbb-2222-2222-2222-222222222202', 'role-member-a@test.dayline.app'),
  ('bbbbbbbb-2222-2222-2222-222222222203', 'role-member-b@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('bbbbbbbb-2222-2222-2222-222222222201', 'role-owner'),
  ('bbbbbbbb-2222-2222-2222-222222222202', 'role-member-a'),
  ('bbbbbbbb-2222-2222-2222-222222222203', 'role-member-b')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222201');
select set_config('t.group_id', (select g.id::text from create_group('Role Test Group') g), false);
select set_config('t.invite_code', (select invite_code from groups where id = current_setting('t.group_id')::uuid), false);
reset role;

set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222202');
select join_group_by_code(current_setting('t.invite_code'));
reset role;

set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222203');
select join_group_by_code(current_setting('t.invite_code'));
reset role;

-- Owner promotes member A to admin.
set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222201');

do $$
declare v_result jsonb;
declare v_role text;
begin
  select set_group_member_role(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222202', 'admin') into v_result;
  if (v_result->>'ok')::boolean is not true then
    raise exception 'FAIL: owner should be able to promote a member to admin, got %', v_result;
  end if;
  select role into v_role from group_members where group_id = current_setting('t.group_id')::uuid and user_id = 'bbbbbbbb-2222-2222-2222-222222222202';
  if v_role <> 'admin' then
    raise exception 'FAIL: member A should now be admin, got %', v_role;
  end if;
  raise notice 'PASS: owner can promote a member to admin';
end $$;

-- Owner cannot change their own role via this function.
do $$
declare v_result jsonb;
begin
  select set_group_member_role(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222201', 'member') into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'cannot_change_owner_role' then
    raise exception 'FAIL: owner role should be unchangeable via this function, got %', v_result;
  end if;
  raise notice 'PASS: the owner cannot demote themselves via set_group_member_role';
end $$;

-- Invalid role value is rejected.
do $$
declare v_result jsonb;
begin
  select set_group_member_role(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222203', 'owner') into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'invalid_role' then
    raise exception 'FAIL: setting role to owner should be rejected, got %', v_result;
  end if;
  raise notice 'PASS: role cannot be set to owner through this function';
end $$;

reset role;

-- The newly-promoted admin cannot promote member B (admin-only-because-
-- owner-said-so, not admin-can-grant-admin).
set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222202');

do $$
declare v_result jsonb;
begin
  select set_group_member_role(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222203', 'admin') into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'not_authorized' then
    raise exception 'FAIL: an admin should not be able to grant admin to someone else, got %', v_result;
  end if;
  raise notice 'PASS: only the owner can change group member roles, not an admin';
end $$;

reset role;

-- A plain member (B) can't demote the newly-promoted admin either.
set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222203');

do $$
declare v_result jsonb;
begin
  select set_group_member_role(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222202', 'member') into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'not_authorized' then
    raise exception 'FAIL: a plain member should not be able to change anyone''s role, got %', v_result;
  end if;
  raise notice 'PASS: a plain member cannot change group member roles';
end $$;

reset role;

-- Owner demotes the admin back to member.
set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222201');

do $$
declare v_result jsonb;
declare v_role text;
begin
  select set_group_member_role(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222202', 'member') into v_result;
  if (v_result->>'ok')::boolean is not true then
    raise exception 'FAIL: owner should be able to demote an admin back to member, got %', v_result;
  end if;
  select role into v_role from group_members where group_id = current_setting('t.group_id')::uuid and user_id = 'bbbbbbbb-2222-2222-2222-222222222202';
  if v_role <> 'member' then
    raise exception 'FAIL: member A should be back to plain member, got %', v_role;
  end if;
  raise notice 'PASS: owner can demote an admin back to member';
end $$;

-- transfer_group_ownership: the previously-nonexistent way out for an
-- owner of a group with other members (leave_group() has always refused
-- them otherwise).
set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222201');

do $$
declare v_result jsonb;
declare v_old_owner_role text;
declare v_new_owner_role text;
begin
  select transfer_group_ownership(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222203') into v_result;
  if (v_result->>'ok')::boolean is not true then
    raise exception 'FAIL: owner should be able to transfer ownership, got %', v_result;
  end if;
  select role into v_old_owner_role from group_members where group_id = current_setting('t.group_id')::uuid and user_id = 'bbbbbbbb-2222-2222-2222-222222222201';
  select role into v_new_owner_role from group_members where group_id = current_setting('t.group_id')::uuid and user_id = 'bbbbbbbb-2222-2222-2222-222222222203';
  if v_old_owner_role <> 'admin' then
    raise exception 'FAIL: outgoing owner should become admin, got %', v_old_owner_role;
  end if;
  if v_new_owner_role <> 'owner' then
    raise exception 'FAIL: new owner should now be owner, got %', v_new_owner_role;
  end if;
  raise notice 'PASS: transfer_group_ownership moves ownership and demotes the outgoing owner to admin';
end $$;

-- The former owner (now admin) can no longer transfer ownership again.
do $$
declare v_result jsonb;
begin
  select transfer_group_ownership(current_setting('t.group_id')::uuid, 'bbbbbbbb-2222-2222-2222-222222222202') into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'not_authorized' then
    raise exception 'FAIL: a former owner (now admin) should not be able to transfer ownership, got %', v_result;
  end if;
  raise notice 'PASS: only the current owner can transfer ownership';
end $$;

reset role;

-- Transferring to someone who isn't a member is rejected.
set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222203');

do $$
declare v_result jsonb;
begin
  select transfer_group_ownership(current_setting('t.group_id')::uuid, gen_random_uuid()) into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'not_a_member' then
    raise exception 'FAIL: transferring ownership to a non-member should be rejected, got %', v_result;
  end if;
  raise notice 'PASS: ownership cannot be transferred to someone who is not a member';
end $$;

-- Now that they've transferred ownership away, the former owner (now
-- admin) can actually leave the group — previously impossible for an
-- owner with other members still present.
reset role;
set role authenticated;
select test_login('bbbbbbbb-2222-2222-2222-222222222201');

do $$
begin
  perform leave_group(current_setting('t.group_id')::uuid);
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from group_members where group_id = current_setting('t.group_id')::uuid and user_id = 'bbbbbbbb-2222-2222-2222-222222222201';
  if v_n <> 0 then
    raise exception 'FAIL: the former owner should have successfully left after transferring ownership, got % rows', v_n;
  end if;
  raise notice 'PASS: a former owner can leave the group after transferring ownership away';
end $$;

reset role;
select 'ALL GROUP ROLE MANAGEMENT TESTS PASSED' as result;
