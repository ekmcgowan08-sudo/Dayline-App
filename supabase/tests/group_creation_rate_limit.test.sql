-- Proves 20260901010000_group_creation_rate_limit.sql actually blocks a
-- 6th group creation within the same hour, not just that the migration
-- applies cleanly.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999904', 'gc-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999904', 'gc-test')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('99999999-9999-9999-9999-999999999904');

do $$
declare i int;
begin
  for i in 1..5 loop
    perform create_group('rate limit test group ' || i);
  end loop;
  raise notice 'PASS: 5 group creations within the window all succeeded';
end $$;

do $$
begin
  begin
    perform create_group('one too many groups');
    raise exception 'FAIL: a 6th group creation within the same hour should have been rate-limited';
  exception
    when others then
      if sqlerrm <> 'rate_limited' then
        raise exception 'FAIL: expected rate_limited, got %', sqlerrm;
      end if;
      raise notice 'PASS: a 6th rapid group creation is rate-limited';
  end;
end $$;

reset role;
select 'ALL GROUP CREATION RATE LIMIT TESTS PASSED' as result;
