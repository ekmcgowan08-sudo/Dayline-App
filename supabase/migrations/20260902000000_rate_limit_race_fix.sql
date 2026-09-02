-- check_rate_limit() read the current event count and inserted a new
-- event as two separate statements, with no lock between them. Two
-- concurrent calls for the same (bucket, subject) — a double-tap, two
-- devices signed into the same account, or a client retry racing its
-- own original request — could both read the count *before* either
-- insert committed, so both would see room under the limit and both
-- return true, letting the caller's actual limit be exceeded by
-- however many callers raced.
--
-- Proven against a real Postgres 16 instance before fixing (not just
-- reasoned about): a copy of the original two-statement function with
-- max_events=1, fired from two concurrent psql connections against the
-- same (bucket, subject), returned true from BOTH calls and left 2 rows
-- in rate_limit_events — one over the stated limit of 1. The same test
-- against this fixed version returns true from exactly one caller and
-- false from the other, with exactly 1 row inserted.
--
-- check_rate_limit() gates real user-facing writes directly via RLS
-- WITH CHECK (comments, reactions, reports, group creation — see
-- 20260901000000_comment_reaction_rate_limiting.sql,
-- 20260831150000_report_hardening.sql,
-- 20260901010000_group_creation_rate_limit.sql) as well as several Edge
-- Functions (transcribe, delete-account, request-montage), so this is a
-- correctness gap across every one of those call sites, not a
-- theoretical one.
--
-- Fix: pg_advisory_xact_lock keyed on (bucket, subject) serializes
-- concurrent callers for the same key before either reads the count —
-- the second caller blocks until the first's insert (or non-insert) has
-- committed, so it always sees an up-to-date count. The lock is
-- transaction-scoped and released automatically at the end of the
-- calling statement/transaction; different (bucket, subject) pairs use
-- different lock keys and never contend with each other.
create or replace function check_rate_limit(p_bucket text, p_subject text, p_max_events int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_subject, 0));

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
