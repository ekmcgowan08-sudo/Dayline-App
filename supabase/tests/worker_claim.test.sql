-- Proves claim_next_montage_job()'s concurrency-safety properties: no
-- double-claim across "workers", oldest-first ordering, and stale-claim
-- reclamation after a crashed worker. Run as postgres (the worker uses the
-- service role, which — like postgres here — bypasses RLS; this function
-- is SECURITY DEFINER regardless, so role doesn't affect its own logic).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999901', 'wc1@test.dayline.app'),
  ('99999999-9999-9999-9999-999999999902', 'wc2@test.dayline.app');
insert into profiles (id, display_name)
  values ('99999999-9999-9999-9999-999999999901', 'wc1@test.dayline.app'),
         ('99999999-9999-9999-9999-999999999902', 'wc2@test.dayline.app')
  on conflict (id) do nothing;

insert into montages (id, user_id, session_date, status, created_at) values
  ('88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '2026-08-01', 'processing', now() - interval '2 minutes'),
  ('88888888-8888-8888-8888-888888888802', '99999999-9999-9999-9999-999999999902', '2026-08-02', 'processing', now() - interval '1 minutes');

do $$
declare
  v1 montages;
  v2 montages;
  v3 montages;
begin
  select * into v1 from claim_next_montage_job('worker-a', 600);
  if v1.id <> '88888888-8888-8888-8888-888888888801' then
    raise exception 'FAIL: expected the oldest processing row to be claimed first, got %', v1.id;
  end if;
  if v1.claimed_by <> 'worker-a' then raise exception 'FAIL: claimed_by not set'; end if;

  select * into v2 from claim_next_montage_job('worker-b', 600);
  if v2.id <> '88888888-8888-8888-8888-888888888802' then
    raise exception 'FAIL: second claim should skip the already-claimed row and return the other one, got %', v2.id;
  end if;

  select * into v3 from claim_next_montage_job('worker-c', 600);
  if v3.id is not null then raise exception 'FAIL: a third claim should find nothing left, got %', v3.id; end if;

  raise notice 'PASS: no double-claim, oldest-first ordering, exhausted queue returns null';
end $$;

-- Simulate worker-a having crashed 11 minutes ago without finishing;
-- with a 600s (10min) staleness threshold the job should become claimable again.
update montages set claimed_at = now() - interval '11 minutes' where id = '88888888-8888-8888-8888-888888888801';

do $$
declare v_reclaimed montages;
begin
  select * into v_reclaimed from claim_next_montage_job('worker-d', 600);
  if v_reclaimed.id <> '88888888-8888-8888-8888-888888888801' then
    raise exception 'FAIL: a stale claim was not reclaimed, got %', v_reclaimed.id;
  end if;
  if v_reclaimed.claimed_by <> 'worker-d' then raise exception 'FAIL: reclaimed row did not update claimed_by'; end if;
  if v_reclaimed.retry_count <> 1 then
    raise exception 'FAIL: reclaiming a stale claim should count as a used retry attempt, got retry_count=%', v_reclaimed.retry_count;
  end if;
  raise notice 'PASS: a stale (crashed-worker) claim is reclaimed after the staleness threshold and counts toward the retry budget';
end $$;

-- Simulate worker-d ALSO crashing without ever finishing (no failJob()
-- call — that only happens in runJob.ts's own try/catch, which never
-- runs if the whole process dies). With p_max_retries=3, one more
-- crash-and-reclaim should still be allowed (retry_count 1 -> 2).
update montages set claimed_at = now() - interval '11 minutes' where id = '88888888-8888-8888-8888-888888888801';
do $$
declare v_reclaimed montages;
begin
  select * into v_reclaimed from claim_next_montage_job('worker-e', 600, 3);
  if v_reclaimed.id <> '88888888-8888-8888-8888-888888888801' or v_reclaimed.retry_count <> 2 then
    raise exception 'FAIL: expected a second reclaim with retry_count=2, got id=% retry_count=%', v_reclaimed.id, v_reclaimed.retry_count;
  end if;
  raise notice 'PASS: a second crash-and-reclaim is still within the retry budget';
end $$;

-- A THIRD crash would push retry_count to 3, meeting p_max_retries=3 —
-- this is the poison-pill scenario this migration exists to fix: without
-- it, this job would keep retrying forever, starving the single-job-at-
-- a-time poller of any other work. It must now be marked 'failed'
-- instead of handed back for yet another attempt, and the claim call
-- must not just return null — nothing else is queued here, so it should,
-- but the important behavior (proven by the poller.ts contract, not
-- reproducible with only one row in this fixture) is that a poison pill
-- never blocks a REAL job sitting behind it in the queue.
update montages set claimed_at = now() - interval '11 minutes' where id = '88888888-8888-8888-8888-888888888801';
do $$
declare v_reclaimed montages;
declare v_status text; v_error text; v_retry int;
begin
  select * into v_reclaimed from claim_next_montage_job('worker-f', 600, 3);
  if v_reclaimed.id is not null then
    raise exception 'FAIL: an exhausted poison-pill job should not be handed back for another attempt, got %', v_reclaimed.id;
  end if;

  select status, error_code, retry_count into v_status, v_error, v_retry
    from montages where id = '88888888-8888-8888-8888-888888888801';
  if v_status <> 'failed' or v_error <> 'worker_crash_max_retries_exceeded' or v_retry <> 3 then
    raise exception 'FAIL: expected failed/worker_crash_max_retries_exceeded/retry_count=3, got status=% error_code=% retry_count=%', v_status, v_error, v_retry;
  end if;
  raise notice 'PASS: a job that exhausts its retry budget via repeated worker crashes is marked failed, not retried forever';
end $$;

-- A poison pill ahead in the queue must not block a real, unclaimed job
-- behind it — the claim function keeps looking rather than returning
-- null the moment it fails the poison pill out.
insert into montages (id, user_id, session_date, status, created_at) values
  ('88888888-8888-8888-8888-888888888803', '99999999-9999-9999-9999-999999999901', '2026-08-03', 'processing', now());
do $$
declare v_reclaimed montages;
begin
  select * into v_reclaimed from claim_next_montage_job('worker-g', 600, 3);
  if v_reclaimed.id <> '88888888-8888-8888-8888-888888888803' then
    raise exception 'FAIL: expected the real job behind the poison pill to be claimed, got %', v_reclaimed.id;
  end if;
  raise notice 'PASS: a poison pill does not block a real job queued behind it';
end $$;

select 'ALL WORKER CLAIM TESTS PASSED' as result;
