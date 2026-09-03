-- Found while fixing the render worker's storage-leak-on-retry bug
-- (worker/src/render/runJob.ts): that fix closes the leak for a crashed
-- retry, but a second, unrelated leak exists in the same 'montages'
-- storage bucket. delete_group() and leave_group()'s last-member-leaving
-- auto-delete path (20260831020000_groups_hardening.sql) both just
-- `delete from groups where id = ...` — the montages table's `group_id
-- references groups(id) on delete cascade` (00000000000001_init.sql)
-- correctly removes the DB rows, but a DB cascade has no way to reach
-- Supabase Storage's HTTP API, so every deleted group's rendered montage
-- video files were left behind in the 'montages' bucket forever, with
-- nothing referencing them and no purge job for this bucket (unlike
-- purge-used-clips for raw clips — see COSTS.md).
--
-- Fixed generally rather than special-cased to group deletion: a BEFORE
-- DELETE trigger on montages queues ANY deleted row's storage_path here,
-- regardless of why the row is being deleted, so this also safety-nets
-- delete-account's personal-montage path (which already removes the
-- storage object explicitly before deleting the auth user — this queues
-- the same path again, but storage removal is idempotent, proven earlier
-- this session, so that's a harmless no-op) and any future deletion path
-- that doesn't yet exist. A scheduled Edge Function
-- (supabase/functions/purge-orphaned-montages) drains this queue the
-- same way purge-used-clips drains raw clips.
create table if not exists pending_storage_purges (
  id bigint generated always as identity primary key,
  bucket text not null,
  storage_path text not null,
  queued_at timestamptz not null default now(),
  purged_at timestamptz
);
create index if not exists pending_storage_purges_unpurged_idx
  on pending_storage_purges (queued_at) where purged_at is null;

-- No client ever needs to see this table — it's an internal queue only
-- the scheduled purge function (service_role) reads.
alter table pending_storage_purges enable row level security;

create or replace function queue_montage_storage_purge() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.storage_path is not null then
    insert into pending_storage_purges (bucket, storage_path) values ('montages', old.storage_path);
  end if;
  return old;
end;
$$;

drop trigger if exists montage_deleted_queue_purge on montages;
create trigger montage_deleted_queue_purge
  before delete on montages
  for each row
  execute function queue_montage_storage_purge();
