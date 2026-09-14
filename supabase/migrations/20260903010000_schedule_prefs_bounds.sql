-- Defense-in-depth bounds on notification_preferences, the same class of
-- gap already closed in 20260831200000_input_validation_hardening.sql for
-- free-text length but never extended to this table's numeric/array
-- columns. saveSchedulePrefs() (mobile/src/services/schedulePrefs.ts)
-- writes these straight through to the table with zero server-side
-- validation; the only bounds are client-side UI widgets (a Stepper
-- capped at reminders_per_day 1-24, wake_hour 0-23, sleep_hour 1-23) that
-- a direct REST/RPC call bypasses entirely, the same way a client-side
-- maxLength always could.
--
-- Found while re-auditing what a direct API caller could still get past,
-- using the "what does the client enforce that the server never checks?"
-- lens from Phases 47/48. Unlike those two, the blast radius here isn't a
-- silent revenue bypass — it's real: computeSlotTimesForDate()
-- (mobile/src/services/schedule.ts) generates one capture_slots row (and
-- one local + one server-backed push) per reminders_per_day / per
-- custom_times entry, every day, with no cap in that function either. An
-- unbounded reminders_per_day (e.g. sent as 100000 via a direct API call)
-- would have syncTodaysCaptureSlots() upsert ~100000 capture_slots rows a
-- day for that account and, since slots land only minutes apart at that
-- density, cause send-capture-reminders to burst hundreds of pushes to
-- that user's own device every cron cycle — real, recurring DB storage
-- growth and push-volume cost, not just a theoretical one. An out-of-
-- range wake_hour/sleep_hour (e.g. sent as 99999) additionally breaks
-- computeSlotTimesForDate() outright: the malformed "HH" segment produces
-- an Invalid Date, and calling .toISOString() on it inside
-- syncTodaysCaptureSlots() throws a RangeError — a self-inflicted crash
-- of the Today screen for that account.
--
-- Limits mirror the mobile client's existing Stepper/slider bounds
-- exactly, so no legitimate input this app has ever produced is rejected
-- by adding these now. quiet_start/quiet_end have no UI yet (unused
-- scaffolding — see mobile/src/services/schedule.ts), so their check
-- only bounds a future real caller, not any input in use today.

alter table notification_preferences
  add constraint notification_prefs_wake_hour_range check (wake_hour between 0 and 23),
  add constraint notification_prefs_sleep_hour_range check (sleep_hour between 1 and 23),
  add constraint notification_prefs_reminders_per_day_range check (reminders_per_day between 1 and 24),
  add constraint notification_prefs_quiet_start_range check (quiet_start is null or quiet_start between 0 and 23),
  add constraint notification_prefs_quiet_end_range check (quiet_end is null or quiet_end between 0 and 23),
  add constraint notification_prefs_custom_times_count check (
    custom_times is null or array_length(custom_times, 1) is null or array_length(custom_times, 1) <= 24
  );
