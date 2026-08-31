-- Private storage buckets. Neither bucket is public. Object paths are
-- random UUIDs (never user id + timestamp, which the recovered baseline
-- used and which is guessable) — enforced by convention in application
-- code (mobile upload service, worker), documented in docs/SECURITY.md.
--
-- clips/{user_id}/{uuid}.mp4       — raw 5-second captures
-- montages/{kind}/{owner_id}/{uuid}.mp4 — rendered output
--
-- The {user_id}/{group_id} folder segment is what RLS keys off of below;
-- everything after it is an opaque random id so a leaked/guessed montage
-- id alone still requires passing the owner-id folder check.

insert into storage.buckets (id, name, public)
  values ('clips', 'clips', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('montages', 'montages', false)
  on conflict (id) do nothing;

-- clips bucket: only the owning user can read/write/delete their own folder.
create policy "clips: owner read" on storage.objects for select using (
  bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "clips: owner write" on storage.objects for insert with check (
  bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "clips: owner delete" on storage.objects for delete using (
  bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text
);

-- montages bucket: intentionally NO client-facing policies. A finished
-- montage's playback URL is always issued by an Edge Function
-- (request-montage / get-montage-url) running with the service role,
-- which checks ownership or group membership itself before minting a
-- short-lived signed URL. A client's own session (anon/authenticated key)
-- can never list, read, or write this bucket directly — see the RLS test
-- "signed URL generation requires authorization" in
-- supabase/tests/storage_rls.test.sql.
