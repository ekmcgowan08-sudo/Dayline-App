-- Basic abusive-input protection + rate limiting on reports, using the
-- same check_rate_limit() ledger the Edge Functions use. RLS WITH CHECK
-- expressions can call any SQL-callable function, so this is enforced at
-- the database layer — a client can't work around it by hitting the table
-- directly instead of going through some particular code path.
alter table reports
  add constraint reports_reason_length check (length(reason) <= 1000 and length(trim(reason)) > 0);

drop policy if exists "user files own reports" on reports;
create policy "user files own reports" on reports for insert with check (
  auth.uid() = reporter_id
  and check_rate_limit('file-report', auth.uid()::text, 20, 3600)
);
