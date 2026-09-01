-- Proves 20260901020000_moderator_remove_content.sql's moderator_remove_content()
-- actually flips the right column for each target type, logs an audit
-- row, rejects an unsupported target type, and — the real bug this
-- migration fixes, not just a documented gap — succeeds for a comment
-- even with no impersonated user (auth.uid() is null), which is exactly
-- how a service-role caller invokes it in production and exactly the
-- case docs/MODERATION_RUNBOOK.md's old guidance (call
-- moderate_delete_comment via service role) would have silently failed
-- on, since that function checks auth.uid() against the montage owner.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999905', 'mod-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999905', 'mod-test')
  on conflict (id) do nothing;
insert into clips (id, user_id, storage_path, duration_ms) values
  ('99999999-5555-5555-5555-555555555501', '99999999-9999-9999-9999-999999999905', 'p/mod-clip.mp4', 5000)
  on conflict (id) do nothing;
insert into montages (id, user_id, session_date, status, storage_path) values
  ('99999999-8888-8888-8888-888888888805', '99999999-9999-9999-9999-999999999905', current_date, 'ready', 'p/mod.mp4')
  on conflict (id) do nothing;
insert into comments (id, montage_id, user_id, body) values
  ('99999999-4444-4444-4444-444444444401', '99999999-8888-8888-8888-888888888805', '99999999-9999-9999-9999-999999999905', 'a comment')
  on conflict (id) do nothing;

-- Run as plain postgres with no request.jwt.claim.sub set (auth.uid() is
-- null) — this is what a real service-role caller with no impersonated
-- user looks like, deliberately not `set role authenticated` + test_login.
select moderator_remove_content('clip', '99999999-5555-5555-5555-555555555501', 'clip test reason');
do $$
declare v_status text; v_deleted timestamptz;
begin
  select moderation_status, deleted_at into v_status, v_deleted from clips where id = '99999999-5555-5555-5555-555555555501';
  if v_status <> 'removed' or v_deleted is null then
    raise exception 'FAIL: clip was not marked removed';
  end if;
  raise notice 'PASS: moderator_remove_content marks a clip removed';
end $$;

select moderator_remove_content('montage', '99999999-8888-8888-8888-888888888805', 'montage test reason');
do $$
declare v_status text; v_error text;
begin
  select status, error_code into v_status, v_error from montages where id = '99999999-8888-8888-8888-888888888805';
  if v_status <> 'failed' or v_error <> 'moderator_removed' then
    raise exception 'FAIL: montage was not marked failed/moderator_removed, got status=% error_code=%', v_status, v_error;
  end if;
  raise notice 'PASS: moderator_remove_content marks a montage failed';
end $$;

select moderator_remove_content('comment', '99999999-4444-4444-4444-444444444401', 'comment test reason');
do $$
declare v_status text; v_deleted timestamptz;
begin
  select moderation_status, deleted_at into v_status, v_deleted from comments where id = '99999999-4444-4444-4444-444444444401';
  if v_status <> 'removed' or v_deleted is null then
    raise exception 'FAIL: comment was not marked removed';
  end if;
  raise notice 'PASS: moderator_remove_content removes a comment even with auth.uid() null (the real fix, not just the documented gap)';
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from moderation_actions
    where target_type in ('clip', 'montage', 'comment') and action = 'remove_content'
    and target_id in ('99999999-5555-5555-5555-555555555501', '99999999-8888-8888-8888-888888888805', '99999999-4444-4444-4444-444444444401');
  if v_n <> 3 then raise exception 'FAIL: expected 3 moderation_actions rows, got %', v_n; end if;
  raise notice 'PASS: every removal logs a moderation_actions row';
end $$;

do $$
begin
  begin
    perform moderator_remove_content('user', '99999999-9999-9999-9999-999999999905', 'wrong target type');
    raise exception 'FAIL: an unsupported target_type should have been rejected';
  exception
    when others then
      if sqlerrm <> 'unsupported_target_type' then
        raise exception 'FAIL: expected unsupported_target_type, got %', sqlerrm;
      end if;
      raise notice 'PASS: an unsupported target_type is rejected';
  end;
end $$;

-- No client role — authenticated or anon — can call this at all.
create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;
set role authenticated;
select test_login('99999999-9999-9999-9999-999999999905');
do $$
begin
  begin
    perform moderator_remove_content('clip', '99999999-5555-5555-5555-555555555501', 'client attempt');
    raise exception 'FAIL: an authenticated client should not be able to call moderator_remove_content';
  exception
    when insufficient_privilege then
      raise notice 'PASS: moderator_remove_content is not callable by the authenticated role';
  end;
end $$;
reset role;

select 'ALL MODERATOR REMOVE CONTENT TESTS PASSED' as result;
