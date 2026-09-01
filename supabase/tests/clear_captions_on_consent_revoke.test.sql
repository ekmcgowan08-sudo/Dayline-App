-- Proves 20260901040000_clear_captions_on_consent_revoke.sql's trigger
-- actually clears an existing caption when a user revokes AI-caption
-- consent, closing the gap docs/PRIVACY_DATA_FLOW.md documented
-- ("disabling consent doesn't retroactively delete existing captions").
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999907', 'consent-a@test.dayline.app'),
  ('99999999-9999-9999-9999-999999999908', 'consent-b@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999907', 'consent-a'),
  ('99999999-9999-9999-9999-999999999908', 'consent-b')
  on conflict (id) do nothing;
insert into clips (id, user_id, storage_path, duration_ms, caption, caption_status) values
  ('99999999-2222-2222-2222-222222222201', '99999999-9999-9999-9999-999999999907', 'p/a.mp4', 5000, 'a real transcript', 'ready'),
  ('99999999-2222-2222-2222-222222222202', '99999999-9999-9999-9999-999999999908', 'p/b.mp4', 5000, 'a different transcript', 'ready')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;
set role authenticated;
select test_login('99999999-9999-9999-9999-999999999907');

-- Real client codepath: mobile/src/services/account.ts#updateTranscriptionConsent
-- does a plain upsert, consented starting false by default.
insert into transcription_consents (user_id, consented) values ('99999999-9999-9999-9999-999999999907', true)
  on conflict (user_id) do update set consented = excluded.consented;
do $$
declare v_caption text; v_status text;
begin
  select caption, caption_status into v_caption, v_status from clips where id = '99999999-2222-2222-2222-222222222201';
  if v_caption is null or v_status <> 'ready' then
    raise exception 'FAIL: granting consent should not touch an existing caption, got caption=% status=%', v_caption, v_status;
  end if;
  raise notice 'PASS: granting consent leaves an existing caption untouched';
end $$;

update transcription_consents set consented = false where user_id = '99999999-9999-9999-9999-999999999907';
do $$
declare v_caption text; v_status text;
begin
  select caption, caption_status into v_caption, v_status from clips where id = '99999999-2222-2222-2222-222222222201';
  if v_caption is not null or v_status <> 'disabled' then
    raise exception 'FAIL: revoking consent should clear the caption, got caption=% status=%', v_caption, v_status;
  end if;
  raise notice 'PASS: revoking consent clears the caption and marks it disabled';
end $$;

do $$
declare v_caption text;
begin
  select caption into v_caption from clips where id = '99999999-2222-2222-2222-222222222202';
  if v_caption <> 'a different transcript' then
    raise exception 'FAIL: another user''s caption was touched by an unrelated consent revoke';
  end if;
  raise notice 'PASS: revoking one user''s consent does not touch another user''s captions';
end $$;

reset role;
select 'ALL CAPTION CONSENT REVOKE TESTS PASSED' as result;
