-- Public-read avatars bucket. Unlike clips/montages, avatars are low-
-- sensitivity, small, user-chosen images that group members legitimately
-- need to see (contributor identification in group montages, comment
-- authorship) — a public bucket with owner-scoped writes is the right
-- tradeoff here, not a private one requiring a signed URL per view.
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

create policy "avatars: public read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars: owner write" on storage.objects for insert with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatars: owner update" on storage.objects for update using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatars: owner delete" on storage.objects for delete using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
