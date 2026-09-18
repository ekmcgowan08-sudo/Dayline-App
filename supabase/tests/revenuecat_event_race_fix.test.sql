-- Proves apply_revenuecat_event() (20260903050000_revenuecat_event_race_
-- fix.sql) correctly rejects a stale event and accepts a newer one, using
-- sequential calls to exercise the WHERE-guard logic itself. The atomicity
-- guarantee (why two *concurrent* callers can't both act on the same
-- stale read) comes from Postgres's own row-level locking on
-- INSERT ... ON CONFLICT DO UPDATE, proven separately against a real
-- Postgres instance during this fix's development (see
-- docs/IMPLEMENTATION_STATUS.md Phase 58) rather than re-proven here,
-- since a single-connection .sql script can't express real concurrency
-- (same limitation documented in rate_limit_race.test.sh and
-- group_limit_race.test.sh for the other two fixes in this same bug
-- class).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aaaaaaaa-1111-1111-1111-111111111101', 'rc-event-a@test.dayline.app'),
  ('aaaaaaaa-1111-1111-1111-111111111102', 'rc-event-b@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in ('aaaaaaaa-1111-1111-1111-111111111101', 'aaaaaaaa-1111-1111-1111-111111111102')
  on conflict (id) do nothing;

-- A brand-new user's first-ever event always applies, whatever its
-- timestamp — there is nothing to compare against yet.
do $$
declare v_applied boolean;
begin
  select apply_revenuecat_event(
    'aaaaaaaa-1111-1111-1111-111111111101'::uuid, 'plus', 'plus', 'active', 'dayline_plus_monthly', 'normal',
    '2027-01-01T00:00:00Z'::timestamptz, true, '2026-06-01T00:00:00Z'::timestamptz
  ) into v_applied;
  if not v_applied then
    raise exception 'FAIL: a first-ever event for a user must always apply';
  end if;
  raise notice 'PASS: first-ever event applies';
end $$;

-- A strictly older event (by its own purchased_at_ms) is rejected and
-- leaves the existing row untouched.
do $$
declare v_applied boolean; v_tier text;
begin
  select apply_revenuecat_event(
    'aaaaaaaa-1111-1111-1111-111111111101'::uuid, 'free', 'free', 'expired', null, null,
    null, false, '2026-05-01T00:00:00Z'::timestamptz -- earlier than the 2026-06-01 event already applied
  ) into v_applied;
  if v_applied then
    raise exception 'FAIL: a strictly older event must be rejected';
  end if;
  select tier into v_tier from subscriptions where user_id = 'aaaaaaaa-1111-1111-1111-111111111101';
  if v_tier <> 'plus' then
    raise exception 'FAIL: a rejected stale event must not have changed the row (tier was %)', v_tier;
  end if;
  raise notice 'PASS: a strictly older event is rejected and the row is untouched';
end $$;

-- A strictly newer event applies and updates the row.
do $$
declare v_applied boolean; v_status text;
begin
  select apply_revenuecat_event(
    'aaaaaaaa-1111-1111-1111-111111111101'::uuid, 'free', 'free', 'expired', null, null,
    null, false, '2026-07-01T00:00:00Z'::timestamptz -- later than the 2026-06-01 event already applied
  ) into v_applied;
  if not v_applied then
    raise exception 'FAIL: a strictly newer event must apply';
  end if;
  select status into v_status from subscriptions where user_id = 'aaaaaaaa-1111-1111-1111-111111111101';
  if v_status <> 'expired' then
    raise exception 'FAIL: a newer event must have updated the row (status was %)', v_status;
  end if;
  raise notice 'PASS: a strictly newer event applies';
end $$;

-- An event with the exact same timestamp as the one already applied
-- still applies (>=, not >) — a redelivery of the same event is
-- idempotent, not silently dropped.
do $$
declare v_applied boolean;
begin
  select apply_revenuecat_event(
    'aaaaaaaa-1111-1111-1111-111111111101'::uuid, 'plus', 'plus', 'active', 'dayline_plus_monthly', 'normal',
    '2028-01-01T00:00:00Z'::timestamptz, true, '2026-07-01T00:00:00Z'::timestamptz -- same instant as the last applied event
  ) into v_applied;
  if not v_applied then
    raise exception 'FAIL: a redelivered event at the same timestamp must still apply (idempotent, not dropped)';
  end if;
  raise notice 'PASS: an event at the same timestamp as the last applied one still applies';
end $$;

-- An event with no purchased_at_ms (null timestamp) always applies,
-- regardless of what's already on the row — matches the original
-- behavior of never treating a timestamp-less event as stale.
do $$
declare v_applied boolean; v_tier text;
begin
  select apply_revenuecat_event(
    'aaaaaaaa-1111-1111-1111-111111111102'::uuid, 'free', 'free', 'active', null, null,
    null, false, null
  ) into v_applied;
  if not v_applied then
    raise exception 'FAIL: an event with no timestamp must always apply';
  end if;

  select apply_revenuecat_event(
    'aaaaaaaa-1111-1111-1111-111111111102'::uuid, 'plus', 'plus', 'active', 'dayline_plus_monthly', 'normal',
    '2027-01-01T00:00:00Z'::timestamptz, true, null
  ) into v_applied;
  if not v_applied then
    raise exception 'FAIL: a second event with no timestamp must also always apply';
  end if;
  select tier into v_tier from subscriptions where user_id = 'aaaaaaaa-1111-1111-1111-111111111102';
  if v_tier <> 'plus' then
    raise exception 'FAIL: the second timestamp-less event should have applied (tier was %)', v_tier;
  end if;
  raise notice 'PASS: events with no timestamp always apply';
end $$;

select 'ALL REVENUECAT EVENT RACE FIX TESTS PASSED' as result;
