-- Proves the defense-in-depth bounds added in
-- 20260903010000_schedule_prefs_bounds.sql on notification_preferences
-- are real database constraints, not just the client's Stepper/UI caps
-- that a direct API call could ignore. See docs/IMPLEMENTATION_STATUS.md
-- Phase 49: reproduced against a real Postgres instance first (an
-- unbounded reminders_per_day, wake_hour, and custom_times array all
-- inserted successfully before this fix).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999951', 'sp-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999951', 'sp-test')
  on conflict (id) do nothing;

do $$
begin
  begin
    insert into notification_preferences (user_id, wake_hour)
    values ('99999999-9999-9999-9999-999999999951', 99999);
    raise exception 'FAIL: an out-of-range wake_hour should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: an out-of-range wake_hour is rejected';
  end;
end $$;

do $$
begin
  begin
    insert into notification_preferences (user_id, sleep_hour)
    values ('99999999-9999-9999-9999-999999999951', 0);
    raise exception 'FAIL: sleep_hour=0 (below the 1-23 range) should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: an out-of-range sleep_hour is rejected';
  end;
end $$;

do $$
begin
  begin
    insert into notification_preferences (user_id, reminders_per_day)
    values ('99999999-9999-9999-9999-999999999951', 999);
    raise exception 'FAIL: reminders_per_day=999 should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: an out-of-range reminders_per_day is rejected';
  end;
end $$;

do $$
declare v_huge_times text[];
begin
  select array_agg(lpad((n % 24)::text, 2, '0') || ':00') into v_huge_times from generate_series(1, 25) n;
  begin
    insert into notification_preferences (user_id, custom_times)
    values ('99999999-9999-9999-9999-999999999951', v_huge_times);
    raise exception 'FAIL: a 25-entry custom_times array should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: an over-long custom_times array is rejected';
  end;
end $$;

do $$
declare v_ok_times text[];
begin
  select array_agg(lpad((n % 24)::text, 2, '0') || ':00') into v_ok_times from generate_series(1, 24) n;
  insert into notification_preferences (user_id, wake_hour, sleep_hour, reminders_per_day, custom_times)
  values ('99999999-9999-9999-9999-999999999951', 0, 23, 24, v_ok_times);
  raise notice 'PASS: legitimate max-of-range values (0/23/24/24 entries) are accepted';
end $$;

select 'ALL SCHEDULE PREFS BOUNDS TESTS PASSED' as result;
