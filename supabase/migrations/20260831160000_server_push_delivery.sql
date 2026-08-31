-- Backs server-side push delivery for capture reminders (Phase 2's local-
-- notification path is the primary one; this is the backup that survives
-- an app kill/reinstall, per the product spec's "server push registration
-- and scheduled delivery" requirement).
--
-- Design: rather than recomputing the schedule server-side (which would
-- duplicate — and risk drifting from — the timezone/DST-aware logic in
-- mobile/src/services/schedule.ts), the send-capture-reminders Edge
-- Function reads the SAME capture_slots rows the client already computes
-- and writes (see syncTodaysCaptureSlots). `notified_at` prevents sending
-- the same slot's server push twice across repeated cron invocations.

alter table capture_slots
  add column if not exists notified_at timestamptz;

-- Lets the Edge Function efficiently find "pending slots whose time has
-- just arrived and haven't been push-notified yet" without a full scan.
create index if not exists capture_slots_pending_unnotified_idx
  on capture_slots(scheduled_at)
  where status = 'pending' and notified_at is null;

-- ---------------------------------------------------------------------
-- Optional pg_cron + pg_net scheduling. Both extensions are available on
-- every Supabase project but not enabled by default, and invoking an Edge
-- Function needs its own project URL + an auth token that don't exist at
-- migration-authoring time — so this block is written to no-op safely
-- (skip with a NOTICE) if the extensions aren't enabled, and the actual
-- schedule().  call is left commented with instructions, since it needs
-- real project-specific values filled in once. See docs/DEPLOYMENT.md
-- "Server push scheduling" for the exact one-time setup step.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_cron;
      create extension if not exists pg_net;
      raise notice 'pg_cron and pg_net are available/enabled. To schedule server push delivery, run once (with your real project values):

select cron.schedule(
  ''send-capture-reminders'',
  ''*/5 * * * *'',
  $cron$
  select net.http_post(
    url := ''https://<your-project-ref>.supabase.co/functions/v1/send-capture-reminders'',
    headers := jsonb_build_object(''Authorization'', ''Bearer <service-role-key>'', ''Content-Type'', ''application/json''),
    body := ''{}''::jsonb
  );
  $cron$
);
';
    exception when insufficient_privilege then
      raise notice 'pg_cron/pg_net exist but this role cannot enable them here — enable via the Supabase dashboard (Database > Extensions), then run the cron.schedule(...) call above.';
    end;
  else
    raise notice 'pg_cron/pg_net are not available in this environment (expected in the local stub — see supabase/tests/_supabase_stub.sql). On a real Supabase project both are available; enable them and run the cron.schedule(...) call documented in docs/DEPLOYMENT.md.';
  end if;
end $$;
