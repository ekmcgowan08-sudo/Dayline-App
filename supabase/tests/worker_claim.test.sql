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
  raise notice 'PASS: a stale (crashed-worker) claim is reclaimed after the staleness threshold';
end $$;

select 'ALL WORKER CLAIM TESTS PASSED' as result;
