-- Generic rate-limit ledger usable from any Edge Function (montage
-- requests, account deletion, etc.) via a single RPC, plus the
-- worker-claim column montage rendering needs to poll safely.

create table if not exists rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  subject text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_lookup_idx on rate_limit_events(bucket, subject, created_at desc);
alter table rate_limit_events enable row level security;
-- No client policies: only SECURITY DEFINER functions and the service role touch this table.

-- Returns true (and logs the event) if under the limit, false (without
-- logging — a rejected call shouldn't itself count toward future windows)
-- otherwise. Always returns normally; see join_group_by_code's comment in
-- 20260831020000_groups_hardening.sql for why rate limiters in this schema
-- never RAISE on the expected "you're over the limit" outcome.
create or replace function check_rate_limit(p_bucket text, p_subject text, p_max_events int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  select count(*) into v_count from rate_limit_events
  where bucket = p_bucket and subject = p_subject and created_at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_max_events then
    return false;
  end if;
  insert into rate_limit_events (bucket, subject) values (p_bucket, p_subject);
  return true;
end;
$$;
revoke all on function check_rate_limit(text, text, int, int) from public;
grant execute on function check_rate_limit(text, text, int, int) to authenticated, service_role;

-- Worker claim tracking: lets the render worker safely poll for work with
-- `UPDATE ... WHERE status IN ('processing','retrying') AND (claimed_at IS
-- NULL OR claimed_at < now() - stale_threshold) RETURNING *`, so two worker
-- instances (or a re-run after a crash) can't double-process the same row.
alter table montages
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text;
