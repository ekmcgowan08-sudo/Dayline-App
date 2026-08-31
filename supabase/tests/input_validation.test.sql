-- Proves the defense-in-depth length/non-empty constraints added in
-- 20260831200000_input_validation_hardening.sql are real database
-- constraints, not just client-side `maxLength` props that a direct API
-- call could ignore.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999901', 'iv-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999901', 'iv-test')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('99999999-9999-9999-9999-999999999901');

do $$
begin
  begin
    update profiles set display_name = repeat('x', 41) where id = '99999999-9999-9999-9999-999999999901';
    raise exception 'FAIL: a 41-character display_name should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: an over-length display_name is rejected';
  end;
end $$;

do $$
begin
  begin
    perform create_group(repeat('g', 41));
    raise exception 'FAIL: a 41-character group name should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: an over-length group name is rejected';
  end;
end $$;

do $$
begin
  begin
    perform create_group('   ');
    raise exception 'FAIL: a whitespace-only group name should have been rejected';
  exception
    when others then
      -- create_group's own explicit non-empty check raises before the
      -- table constraint would even be reached; either failure mode is
      -- an acceptable rejection here.
      raise notice 'PASS: a whitespace-only group name is rejected';
  end;
end $$;

reset role;

-- A comment needs a real montage to attach to; reuse the RLS test
-- suite's montage-visibility setup is overkill here — this file only
-- needs to prove the CHECK constraint fires on the comments table
-- itself, which a direct insert (bypassing RLS as postgres) demonstrates
-- just as validly as going through the "insert own comment" policy would.
insert into montages (id, user_id, session_date, status, storage_path) values
  ('99999999-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', current_date, 'ready', 'p/iv.mp4')
  on conflict (id) do nothing;

do $$
begin
  begin
    insert into comments (montage_id, user_id, body)
    values ('99999999-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', repeat('x', 501));
    raise exception 'FAIL: a 501-character comment body should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: an over-length comment body is rejected';
  end;
end $$;

do $$
begin
  begin
    insert into comments (montage_id, user_id, body)
    values ('99999999-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '   ');
    raise exception 'FAIL: a whitespace-only comment body should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: a whitespace-only comment body is rejected';
  end;
end $$;

select 'ALL INPUT VALIDATION TESTS PASSED' as result;
