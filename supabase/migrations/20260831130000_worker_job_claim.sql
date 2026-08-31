-- Atomic job claiming for the render worker. `FOR UPDATE SKIP LOCKED` lets
-- multiple worker instances (or a restarted worker) poll the same table
-- concurrently without ever double-claiming a row — whichever transaction
-- gets there first locks it, and every other concurrent caller simply
-- skips it and looks at the next candidate instead of blocking or erroring.
-- Only the service role may execute this (the worker's own credential;
-- never exposed to the mobile client).
create or replace function claim_next_montage_job(p_worker_id text, p_stale_after_seconds int default 600) returns montages
language plpgsql security definer set search_path = public as $$
declare
  v_row montages;
begin
  select * into v_row from montages
  where status in ('processing', 'retrying')
    and (claimed_at is null or claimed_at < now() - make_interval(secs => p_stale_after_seconds))
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update montages set claimed_at = now(), claimed_by = p_worker_id where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function claim_next_montage_job(text, int) from public, authenticated;
grant execute on function claim_next_montage_job(text, int) to service_role;
