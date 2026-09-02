-- Proves 20260901070000_push_token_reassignment.sql's register_push_token()
-- actually reassigns a shared device's token across users, and proves the
-- bug it fixes is real: the plain client-side upsert this replaced throws
-- an RLS error on the exact same scenario.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999910', 'devicea-test@test.dayline.app'),
  ('99999999-9999-9999-9999-999999999911', 'deviceb-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999910', 'device-a'),
  ('99999999-9999-9999-9999-999999999911', 'device-b')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;

-- User A registers a device.
select test_login('99999999-9999-9999-9999-999999999910');
select register_push_token('ExponentPushToken[shared-device-test]', 'ios');
do $$
declare v_user_id uuid;
begin
  select user_id into v_user_id from device_push_tokens where expo_push_token = 'ExponentPushToken[shared-device-test]';
  if v_user_id <> '99999999-9999-9999-9999-999999999910' then
    raise exception 'FAIL: token was not registered to user A';
  end if;
  raise notice 'PASS: register_push_token registers a new token';
end $$;

-- This is the bug the RPC fixes: the plain client-side upsert this
-- replaced throws an RLS error the moment a different user tries to
-- claim a token someone else already registered.
do $$
begin
  begin
    insert into device_push_tokens (user_id, expo_push_token, platform)
      values ('99999999-9999-9999-9999-999999999911', 'ExponentPushToken[shared-device-test]', 'ios')
      on conflict (expo_push_token) do update set user_id = excluded.user_id;
    raise exception 'FAIL: a plain client upsert should have hit the RLS bug this RPC fixes';
  exception
    when insufficient_privilege then
      raise notice 'PASS: confirms the bug is real — a plain upsert is blocked by RLS on the conflicting row';
  end;
end $$;

-- User B logs in on the same physical device and registers — this must
-- actually succeed and reassign the token, not silently fail like above.
select test_login('99999999-9999-9999-9999-999999999911');
select register_push_token('ExponentPushToken[shared-device-test]', 'android');
do $$
declare v_user_id uuid; v_platform text; v_n int;
begin
  select count(*) into v_n from device_push_tokens where expo_push_token = 'ExponentPushToken[shared-device-test]';
  if v_n <> 1 then raise exception 'FAIL: expected exactly one row for the shared token, got %', v_n; end if;

  select user_id, platform into v_user_id, v_platform from device_push_tokens where expo_push_token = 'ExponentPushToken[shared-device-test]';
  if v_user_id <> '99999999-9999-9999-9999-999999999911' or v_platform <> 'android' then
    raise exception 'FAIL: token was not reassigned to user B, got user_id=% platform=%', v_user_id, v_platform;
  end if;
  raise notice 'PASS: register_push_token reassigns a shared device''s token to the new user';
end $$;

-- Re-registering the same token for the same user (normal app-launch
-- re-registration) must not error and must not duplicate the row.
select register_push_token('ExponentPushToken[shared-device-test]', 'android');
do $$
declare v_n int;
begin
  select count(*) into v_n from device_push_tokens where expo_push_token = 'ExponentPushToken[shared-device-test]';
  if v_n <> 1 then raise exception 'FAIL: re-registering the same token duplicated the row, got % rows', v_n; end if;
  raise notice 'PASS: re-registering the same token for the same user is a safe no-op';
end $$;

do $$
begin
  begin
    perform register_push_token('ExponentPushToken[bad-platform]', 'windows');
    raise exception 'FAIL: an invalid platform should have been rejected';
  exception
    when others then
      if sqlerrm <> 'invalid_platform' then raise exception 'FAIL: expected invalid_platform, got %', sqlerrm; end if;
      raise notice 'PASS: an invalid platform is rejected';
  end;
end $$;

reset role;
select 'ALL PUSH TOKEN REASSIGNMENT TESTS PASSED' as result;
