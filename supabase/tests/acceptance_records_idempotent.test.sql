-- Proves 20260902030000_acceptance_records_idempotent.sql's unique
-- constraint actually makes re-recording the same (user, document,
-- version) an upsert no-op — the scenario: onboarding_completed_at is
-- only set at the very end of onboarding, and the root route sends any
-- user without it all the way back to the first onboarding screen. A
-- user who accepted terms/privacy/rules/age, then had the app killed on
-- a later onboarding screen, lands back on the consent screen and
-- re-submits the same acceptance rows on next launch.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999914', 'accept-test2@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999914', 'accept-test2')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('99999999-9999-9999-9999-999999999914');

-- First consent-screen pass.
insert into acceptance_records (user_id, document, version) values
  ('99999999-9999-9999-9999-999999999914', 'terms', 'v1'),
  ('99999999-9999-9999-9999-999999999914', 'privacy', 'v1'),
  ('99999999-9999-9999-9999-999999999914', 'community_rules', 'v1'),
  ('99999999-9999-9999-9999-999999999914', 'age_confirmation', 'v1')
on conflict (user_id, document, version) do nothing;

do $$
declare v_count int;
begin
  select count(*) into v_count from acceptance_records where user_id = '99999999-9999-9999-9999-999999999914';
  if v_count <> 4 then raise exception 'FAIL: expected 4 rows after the first consent pass, got %', v_count; end if;
  raise notice 'PASS: first consent pass records exactly 4 rows';
end $$;

do $$
declare v_first_accepted_at timestamptz;
begin
  select accepted_at into v_first_accepted_at from acceptance_records
    where user_id = '99999999-9999-9999-9999-999999999914' and document = 'terms' and version = 'v1';
  perform pg_sleep(1.1);

  -- Simulated interrupted-onboarding retry: same rows, same statement
  -- shape the client sends.
  insert into acceptance_records (user_id, document, version) values
    ('99999999-9999-9999-9999-999999999914', 'terms', 'v1'),
    ('99999999-9999-9999-9999-999999999914', 'privacy', 'v1'),
    ('99999999-9999-9999-9999-999999999914', 'community_rules', 'v1'),
    ('99999999-9999-9999-9999-999999999914', 'age_confirmation', 'v1')
  on conflict (user_id, document, version) do nothing;

  declare
    v_count int;
    v_second_accepted_at timestamptz;
  begin
    select count(*) into v_count from acceptance_records where user_id = '99999999-9999-9999-9999-999999999914';
    if v_count <> 4 then raise exception 'FAIL: expected still exactly 4 rows after the retry, got %', v_count; end if;

    select accepted_at into v_second_accepted_at from acceptance_records
      where user_id = '99999999-9999-9999-9999-999999999914' and document = 'terms' and version = 'v1';
    if v_second_accepted_at <> v_first_accepted_at then
      raise exception 'FAIL: accepted_at changed on retry (% -> %) — should preserve the first acceptance time', v_first_accepted_at, v_second_accepted_at;
    end if;
  end;
  raise notice 'PASS: a retried consent pass stays at exactly 4 rows, preserving the original accepted_at';
end $$;

-- A genuinely new version of a document (e.g. terms updated) still
-- records as its own row, not silently swallowed.
insert into acceptance_records (user_id, document, version) values
  ('99999999-9999-9999-9999-999999999914', 'terms', 'v2')
on conflict (user_id, document, version) do nothing;
do $$
declare v_count int;
begin
  select count(*) into v_count from acceptance_records
    where user_id = '99999999-9999-9999-9999-999999999914' and document = 'terms';
  if v_count <> 2 then raise exception 'FAIL: expected 2 terms rows (v1 and v2), got %', v_count; end if;
  raise notice 'PASS: accepting a new document version records a new row rather than being swallowed';
end $$;

reset role;
select 'ALL ACCEPTANCE RECORDS IDEMPOTENT TESTS PASSED' as result;
