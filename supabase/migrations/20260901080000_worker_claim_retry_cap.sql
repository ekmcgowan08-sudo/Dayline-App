-- claim_next_montage_job() reclaims a stale claim (a worker that crashed
-- mid-render without ever calling failJob() to record the failure) but
-- never touched retry_count or checked it against a limit — unlike the
-- graceful-failure path in worker/src/render/runJob.ts's failJob(),
-- which increments retry_count and gives up after config.maxRetries.
--
-- Found by tracing what happens to a job that crashes the whole worker
-- process rather than throwing a catchable exception (an unhandled
-- promise rejection, an OOM kill, a container redeploy, a native
-- ffmpeg crash) — runJob.ts's try/catch never runs, so failJob() never
-- fires. The row just sits at 'processing' until the staleness
-- threshold (600s default) passes, then gets reclaimed and handed to
-- runJob() again, unconditionally, forever. Since poller.ts is
-- deliberately single-job-at-a-time (see its own comment on why), a
-- job that reliably crashes the worker every attempt doesn't just fail
-- to render for its own requester — it starves the entire render
-- pipeline for every user, indefinitely, in ~10-minute cycles.
--
-- Fix: a reclaimed stale claim now counts as a used retry attempt, and
-- once it would exceed the same retry budget the graceful path already
-- enforces, the job is marked 'failed' (not returned for another
-- attempt) and the function keeps looking for a real job instead of
-- returning null and leaving the poller idle behind a poison pill.
create or replace function claim_next_montage_job(p_worker_id text, p_stale_after_seconds int default 600, p_max_retries int default 3) returns montages
language plpgsql security definer set search_path = public as $$
declare
  v_row montages;
  v_was_stale boolean;
begin
  loop
    select * into v_row from montages
    where status in ('processing', 'retrying')
      and (claimed_at is null or claimed_at < now() - make_interval(secs => p_stale_after_seconds))
    order by created_at asc
    for update skip locked
    limit 1;

    if not found then
      return null;
    end if;

    v_was_stale := v_row.claimed_at is not null;

    if v_was_stale and v_row.retry_count + 1 >= p_max_retries then
      update montages set
        status = 'failed',
        error_code = 'worker_crash_max_retries_exceeded',
        retry_count = v_row.retry_count + 1,
        claimed_at = null,
        claimed_by = null
      where id = v_row.id;
      -- Now 'failed', so the next loop iteration's WHERE clause excludes
      -- it — keep looking instead of stalling the poller on this row.
      continue;
    end if;

    update montages set
      claimed_at = now(),
      claimed_by = p_worker_id,
      retry_count = case when v_was_stale then v_row.retry_count + 1 else v_row.retry_count end
    where id = v_row.id
    returning * into v_row;

    return v_row;
  end loop;
end;
$$;
revoke all on function claim_next_montage_job(text, int, int) from public, authenticated;
grant execute on function claim_next_montage_job(text, int, int) to service_role;
-- The two-argument overload from 20260831130000_worker_job_claim.sql
-- would otherwise coexist as an ambiguous candidate for PostgREST/RPC
-- callers that omit p_max_retries.
drop function if exists claim_next_montage_job(text, int);
