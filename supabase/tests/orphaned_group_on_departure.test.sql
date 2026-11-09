-- Proves 20260903110000_orphaned_group_on_departure_fix.sql: when a
-- group's sole member deletes their account, the group itself is now
-- deleted along with them, instead of surviving forever as an orphaned
-- row with a still-active invite code that the next person to join
-- lands in as a powerless 'member' with no owner, no admin, and no way
-- for anyone to ever become one. Reproduced against a real Postgres
-- instance with no concurrency needed at all: create a solo-member
-- group, delete that member's account, the group and its invite code
-- both survived, and a completely unrelated later join succeeded with
-- the joiner stuck as a plain member of an unmanageable group.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('55555555-6666-6666-6666-666666666601', 'orphan-solo-owner@test.dayline.app'),
  ('55555555-6666-6666-6666-666666666602', 'orphan-later-joiner@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('55555555-6666-6666-6666-666666666601', 'orphan-solo-owner'),
  ('55555555-6666-6666-6666-666666666602', 'orphan-later-joiner')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('55555555-6666-6666-6666-666666666601');
-- Stash the invite code where a later do $$ block can read it via
-- current_setting() -- psql's own :'var' substitution doesn't reach
-- inside dollar-quoted PL/pgSQL bodies, same reason test_login() itself
-- goes through set_config() rather than a bound parameter.
select set_config('test.orphan_invite_code', (create_group('orphan-departure solo group')).invite_code, false);
reset role;

-- The sole member of this group deletes their account (the same
-- primitive delete-account uses: admin.auth.admin.deleteUser() issues
-- exactly this delete, cascading onto group_members via its own FK and
-- firing the trigger this migration fixes).
delete from auth.users where id = '55555555-6666-6666-6666-666666666601';

do $$
declare v_n int;
begin
  select count(*) into v_n from groups where name = 'orphan-departure solo group';
  if v_n <> 0 then
    raise exception 'FAIL: a group whose sole member just deleted their account should be deleted too, but it still exists — an orphan with a live invite code and no possible owner.';
  end if;
  raise notice 'PASS: a solo member''s account deletion deletes the now-empty group instead of orphaning it';
end $$;

-- Defense in depth: the group's old invite code must be genuinely dead,
-- not just the row hidden some other way -- a fresh join attempt with
-- it must fail cleanly rather than resurrecting a memberless group.
set role authenticated;
select test_login('55555555-6666-6666-6666-666666666602');
do $$
declare v_result jsonb;
begin
  select join_group_by_code(current_setting('test.orphan_invite_code')) into v_result;
  if (v_result ->> 'ok')::boolean is true then
    raise exception 'FAIL: joined a group that should have been deleted along with its sole member''s account: %', v_result;
  end if;
  raise notice 'PASS: the deleted group''s invite code no longer resolves to anything joinable';
end $$;
reset role;

select 'ALL ORPHANED GROUP ON DEPARTURE TESTS PASSED' as result;
