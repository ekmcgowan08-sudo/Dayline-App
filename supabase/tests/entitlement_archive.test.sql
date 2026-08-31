-- Proves list_my_personal_montages() actually enforces the free-tier
-- memory-archive window server-side (not just as a client-side UI
-- hypothesis) and that upgrading to plus lifts it immediately.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777701', 'archive-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('77777777-7777-7777-7777-777777777701', 'archive-test')
  on conflict (id) do nothing;

insert into montages (id, user_id, session_date, status, storage_path) values
  ('66666666-6666-6666-6666-666666666601', '77777777-7777-7777-7777-777777777701', current_date, 'ready', 'p/1.mp4'),
  ('66666666-6666-6666-6666-666666666602', '77777777-7777-7777-7777-777777777701', current_date - interval '60 days', 'ready', 'p/2.mp4');

insert into subscriptions (user_id, tier, status, entitlement) values
  ('77777777-7777-7777-7777-777777777701', 'free', 'active', 'free');

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('77777777-7777-7777-7777-777777777701');

do $$
declare v_n int;
begin
  select count(*) into v_n from list_my_personal_montages();
  if v_n <> 1 then raise exception 'FAIL: free-tier user should see only 1 montage within the 30-day archive window, got %', v_n; end if;
  raise notice 'PASS: free-tier archive window excludes a 60-day-old montage';
end $$;

reset role;
update subscriptions set entitlement = 'plus', tier = 'plus' where user_id = '77777777-7777-7777-7777-777777777701';
set role authenticated;
select test_login('77777777-7777-7777-7777-777777777701');

do $$
declare v_n int;
begin
  select count(*) into v_n from list_my_personal_montages();
  if v_n <> 2 then raise exception 'FAIL: plus-tier user should see both montages, got %', v_n; end if;
  raise notice 'PASS: plus-tier user sees the full archive';
end $$;

reset role;
select 'ALL ENTITLEMENT ARCHIVE TESTS PASSED' as result;
