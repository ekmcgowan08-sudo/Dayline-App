-- Proves the two database-level guarantees behind automated data-export
-- fulfillment (supabase/functions/fulfill-data-export,
-- supabase/functions/get-export-url): request_data_export() doesn't pile
-- up duplicate pending rows, and a user can never read another user's
-- export request (which would leak whether/when they requested one, plus
-- the storage_path get-export-url signs from once fulfilled).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aaaaaaaa-1111-1111-1111-111111111101', 'export-a@test.dayline.app'),
  ('aaaaaaaa-1111-1111-1111-111111111102', 'export-b@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('aaaaaaaa-1111-1111-1111-111111111101', 'export-a'),
  ('aaaaaaaa-1111-1111-1111-111111111102', 'export-b')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('aaaaaaaa-1111-1111-1111-111111111101');

select request_data_export();
select request_data_export();
select request_data_export();

do $$
declare v_n int;
begin
  select count(*) into v_n from data_export_requests where user_id = 'aaaaaaaa-1111-1111-1111-111111111101';
  if v_n <> 1 then
    raise exception 'FAIL: calling request_data_export() 3 times should leave exactly 1 pending row, got %', v_n;
  end if;
  raise notice 'PASS: request_data_export() does not pile up duplicate pending requests';
end $$;

reset role;

-- Simulate fulfillment the way fulfill-data-export (service role) would.
update data_export_requests
  set status = 'fulfilled', fulfilled_at = now(), storage_path = 'aaaaaaaa-1111-1111-1111-111111111101/fake.json'
  where user_id = 'aaaaaaaa-1111-1111-1111-111111111101';

-- A second request is allowed once the first is no longer pending.
set role authenticated;
select test_login('aaaaaaaa-1111-1111-1111-111111111101');
select request_data_export();

do $$
declare v_n int;
begin
  select count(*) into v_n from data_export_requests where user_id = 'aaaaaaaa-1111-1111-1111-111111111101';
  if v_n <> 2 then
    raise exception 'FAIL: a new request should be allowed once the prior one is fulfilled, got % rows', v_n;
  end if;
  raise notice 'PASS: a new request is allowed once the prior one is no longer pending';
end $$;

reset role;

-- User B must never see user A's export requests (own-row RLS).
set role authenticated;
select test_login('aaaaaaaa-1111-1111-1111-111111111102');

do $$
declare v_n int;
begin
  select count(*) into v_n from data_export_requests where user_id = 'aaaaaaaa-1111-1111-1111-111111111101';
  if v_n <> 0 then
    raise exception 'FAIL: user B should see zero of user A''s export requests, got %', v_n;
  end if;
  raise notice 'PASS: a user cannot read another user''s data-export requests';
end $$;

reset role;
select 'ALL DATA EXPORT TESTS PASSED' as result;
