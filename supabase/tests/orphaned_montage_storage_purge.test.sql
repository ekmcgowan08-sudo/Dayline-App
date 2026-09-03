-- Proves 20260902010000_orphaned_montage_storage_purge.sql's trigger
-- actually queues a montage's storage_path for purge when its row is
-- deleted — both via a group's cascade delete (the real bug: delete_group
-- never touched the montages storage bucket) and via a direct delete (the
-- general safety net this was built as, not special-cased to groups).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999906', 'purge-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999906', 'purge-test')
  on conflict (id) do nothing;

insert into groups (id, name, created_by, invite_code) values
  ('99999999-7777-7777-7777-777777777701', 'purge test group', '99999999-9999-9999-9999-999999999906', 'PURGE01')
  on conflict (id) do nothing;
insert into group_members (group_id, user_id, role) values
  ('99999999-7777-7777-7777-777777777701', '99999999-9999-9999-9999-999999999906', 'owner')
  on conflict do nothing;
insert into montages (id, group_id, session_date, status, storage_path) values
  ('99999999-8888-8888-8888-888888888806', '99999999-7777-7777-7777-777777777701', current_date, 'ready', 'group/99999999-7777-7777-7777-777777777701/orphan-test.mp4')
  on conflict (id) do nothing;

delete from pending_storage_purges where storage_path like '%orphan-test%';

-- Delete the group directly (same effect as delete_group()/leave_group()'s
-- last-member-leaving path: `on delete cascade` removes the montages row).
delete from groups where id = '99999999-7777-7777-7777-777777777701';

do $$
declare v_count int;
begin
  select count(*) into v_count from pending_storage_purges
  where bucket = 'montages'
    and storage_path = 'group/99999999-7777-7777-7777-777777777701/orphan-test.mp4'
    and purged_at is null;
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 queued purge row for the group-cascade-deleted montage, got %', v_count;
  end if;
  raise notice 'PASS: deleting a group queues its montage''s storage_path for purge';
end $$;

-- A montage with no storage_path (never finished rendering) must not
-- queue a bogus null/empty purge.
insert into montages (id, user_id, session_date, status, storage_path) values
  ('99999999-8888-8888-8888-888888888807', '99999999-9999-9999-9999-999999999906', current_date - 1, 'processing', null)
  on conflict (id) do nothing;
delete from montages where id = '99999999-8888-8888-8888-888888888807';
do $$
declare v_count int;
begin
  select count(*) into v_count from pending_storage_purges where storage_path is null;
  if v_count <> 0 then
    raise exception 'FAIL: a montage with a null storage_path should never be queued for purge';
  end if;
  raise notice 'PASS: a montage with no storage_path is not queued';
end $$;

-- Direct delete (the general safety net, not just the group-cascade path).
insert into montages (id, user_id, session_date, status, storage_path) values
  ('99999999-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999906', current_date - 2, 'ready', 'personal/99999999-9999-9999-9999-999999999906/direct-delete-test.mp4')
  on conflict (id) do nothing;
delete from montages where id = '99999999-8888-8888-8888-888888888808';
do $$
declare v_count int;
begin
  select count(*) into v_count from pending_storage_purges
  where storage_path = 'personal/99999999-9999-9999-9999-999999999906/direct-delete-test.mp4' and purged_at is null;
  if v_count <> 1 then
    raise exception 'FAIL: a directly deleted montage row should also queue its storage_path for purge, got %', v_count;
  end if;
  raise notice 'PASS: directly deleting a montage row also queues its storage_path for purge';
end $$;

select 'ALL ORPHANED MONTAGE STORAGE PURGE TESTS PASSED' as result;
