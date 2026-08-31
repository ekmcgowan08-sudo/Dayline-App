-- Account deletion. `request_account_deletion()` is callable by the user
-- themselves and marks intent immediately (audit row + profile status);
-- the actual data/media purge is performed by the `delete-account` Edge
-- Function (service role), which a client calls right away in this build
-- (no cron infrastructure is assumed to exist) — see docs/DEPLOYMENT.md
-- for wiring a scheduled grace-period purge in production instead.

create table if not exists account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed')),
  scheduled_purge_at timestamptz not null default (now() + interval '30 days')
);
alter table account_deletion_requests enable row level security;
create policy "read own deletion request" on account_deletion_requests for select using (auth.uid() = user_id);

create or replace function request_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into account_deletion_requests (user_id) values (auth.uid())
  on conflict (user_id) do nothing;
  update profiles set account_status = 'pending_deletion', updated_at = now() where id = auth.uid();
end;
$$;
revoke all on function request_account_deletion() from public;
grant execute on function request_account_deletion() to authenticated;

-- Per-item deletion: a user may delete an individual clip (soft delete —
-- the storage object is removed by the app/worker, the row is kept with
-- deleted_at set so montage_clips history/foreign keys stay intact) or a
-- personal montage they own (hard delete; group montages are deleted via
-- delete_group() cascade only, never by an individual member).
create or replace function delete_own_clip(p_clip_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update clips set deleted_at = now(), status = 'deleted'
  where id = p_clip_id and user_id = auth.uid();
  if not found then raise exception 'not_found_or_not_yours'; end if;
end;
$$;
revoke all on function delete_own_clip(uuid) from public;
grant execute on function delete_own_clip(uuid) to authenticated;

create or replace function delete_own_personal_montage(p_montage_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from montages where id = p_montage_id and user_id = auth.uid() and group_id is null;
  if not found then raise exception 'not_found_or_not_yours'; end if;
end;
$$;
revoke all on function delete_own_personal_montage(uuid) from public;
grant execute on function delete_own_personal_montage(uuid) to authenticated;
