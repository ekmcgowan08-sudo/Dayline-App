-- Automated data-export fulfillment. Previously (see
-- 20260831140000_data_export_and_deletion_audit.sql and
-- docs/PRIVACY_DATA_FLOW.md) `request_data_export()` recorded a genuine,
-- auditable request, but fulfilling it was a manual operator step — this
-- repo has no email-sending infrastructure, so the original plan was
-- "an operator compiles a file and emails it by hand." That's replaced
-- here with a real pipeline: a scheduled Edge Function
-- (fulfill-data-export) compiles the requester's data into JSON and
-- uploads it to a private bucket; the user retrieves it via a
-- short-lived signed URL (get-export-url), the same pattern
-- get-montage-url already uses for montage playback. No email needed —
-- the download happens inside the app the user already trusts.

alter table data_export_requests
  add column if not exists storage_path text;

-- Prevent a user from piling up duplicate pending requests by tapping
-- "Request export" repeatedly — one pending request per user is enough;
-- the scheduled function will get to it.
create or replace function request_data_export() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into data_export_requests (user_id)
  select auth.uid()
  where not exists (
    select 1 from data_export_requests where user_id = auth.uid() and status = 'pending'
  );
end;
$$;
revoke all on function request_data_export() from public;
grant execute on function request_data_export() to authenticated;

-- exports bucket: same treatment as `montages` — intentionally NO
-- client-facing storage policies. A client's own session key can never
-- read this bucket directly; every download goes through the
-- get-export-url Edge Function, which checks the request actually
-- belongs to the caller and is fulfilled before minting a signed URL.
insert into storage.buckets (id, name, public)
  values ('exports', 'exports', false)
  on conflict (id) do nothing;
