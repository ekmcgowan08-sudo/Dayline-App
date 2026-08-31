-- Proves the per-group timezone feature added for group-montage day
-- boundaries (worker/src/render/fetchEligibleClips.ts) is actually
-- enforced server-side: only an owner/admin can set it, Postgres itself
-- rejects a bogus timezone name (real IANA validation, not a regex), and
-- the raw-UPDATE gap closed alongside this (an owner/admin previously
-- could PATCH ANY column on `groups`, including invite_code/max_members,
-- via a raw REST update) is actually gone, not just removed from the UI.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888801', 'tz-owner@test.dayline.app'),
  ('88888888-8888-8888-8888-888888888802', 'tz-member@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('88888888-8888-8888-8888-888888888801', 'tz-owner'),
  ('88888888-8888-8888-8888-888888888802', 'tz-member')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('88888888-8888-8888-8888-888888888801');

select set_config('t.group_id', (select g.id::text from create_group('TZ Test Group') g), false);
select set_config('t.invite_code', (select invite_code from groups where id = current_setting('t.group_id')::uuid), false);
reset role;

-- Second user (plain member) joins via invite code.
set role authenticated;
select test_login('88888888-8888-8888-8888-888888888802');
select join_group_by_code(current_setting('t.invite_code'));
reset role;

-- Owner sets a real, valid timezone.
set role authenticated;
select test_login('88888888-8888-8888-8888-888888888801');

do $$
declare v_result jsonb;
declare v_tz text;
begin
  select set_group_timezone(current_setting('t.group_id')::uuid, 'America/New_York') into v_result;
  if (v_result->>'ok')::boolean is not true then
    raise exception 'FAIL: owner should be able to set a valid group timezone, got %', v_result;
  end if;
  select timezone into v_tz from groups where id = current_setting('t.group_id')::uuid;
  if v_tz <> 'America/New_York' then
    raise exception 'FAIL: groups.timezone should have been updated, got %', v_tz;
  end if;
  raise notice 'PASS: owner can set a valid IANA group timezone';
end $$;

-- Owner attempts a bogus timezone — Postgres itself rejects it.
do $$
declare v_result jsonb;
begin
  select set_group_timezone(current_setting('t.group_id')::uuid, 'Not/ARealZone') into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'invalid_timezone' then
    raise exception 'FAIL: bogus timezone should be rejected, got %', v_result;
  end if;
  raise notice 'PASS: an unrecognized timezone name is rejected server-side';
end $$;

reset role;

-- Plain member (not owner/admin) is refused.
set role authenticated;
select test_login('88888888-8888-8888-8888-888888888802');

do $$
declare v_result jsonb;
begin
  select set_group_timezone(current_setting('t.group_id')::uuid, 'Europe/London') into v_result;
  if (v_result->>'ok')::boolean is not false or (v_result->>'error') <> 'not_authorized' then
    raise exception 'FAIL: a plain member should not be able to change the group timezone, got %', v_result;
  end if;
  raise notice 'PASS: a plain member cannot change the group timezone';
end $$;

reset role;

-- The owner also can't bypass the RPC with a raw table UPDATE — this is
-- the closed latent gap: UPDATE is fully revoked from `authenticated` on
-- `groups`, so even the group's own owner can't PATCH invite_code or
-- max_members directly, only through dedicated validated RPCs.
set role authenticated;
select test_login('88888888-8888-8888-8888-888888888801');

do $$
begin
  begin
    update groups set timezone = 'Europe/Paris' where id = current_setting('t.group_id')::uuid;
    raise exception 'FAIL: raw UPDATE on groups should be rejected for the authenticated role';
  exception
    when insufficient_privilege then
      raise notice 'PASS: raw UPDATE on groups is rejected for authenticated (must go through set_group_timezone)';
  end;
end $$;

reset role;
select 'ALL GROUP TIMEZONE TESTS PASSED' as result;
