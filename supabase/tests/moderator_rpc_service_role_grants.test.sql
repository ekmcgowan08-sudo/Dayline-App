-- Proves 20260902020000_moderator_rpc_service_role_grants.sql's fix for
-- a real bug: every moderator_* RPC revoked EXECUTE from public/
-- authenticated but never granted it back to service_role, the actual
-- role MODERATION_RUNBOOK.md instructs a moderator to call these with.
-- The existing moderator_*.test.sql files never caught this because they
-- deliberately simulate a service-role caller's auth.uid()=null by
-- running as the plain `postgres` superuser — which bypasses every GRANT
-- check, not just RLS, so it never actually exercises whether the real
-- `service_role` role can invoke the function at all. This test does,
-- using `set role service_role` the way a real PostgREST RPC call runs.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999912', 'svc-grant-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name, account_status) values
  ('99999999-9999-9999-9999-999999999912', 'svc-grant-test', 'active')
  on conflict (id) do nothing;
insert into clips (id, user_id, storage_path, duration_ms) values
  ('99999999-5555-5555-5555-555555555502', '99999999-9999-9999-9999-999999999912', 'p/svc-grant-clip.mp4', 5000)
  on conflict (id) do nothing;
insert into montages (id, user_id, session_date, status, storage_path) values
  ('99999999-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999912', current_date - 5, 'ready', 'p/svc-grant.mp4')
  on conflict (id) do nothing;
insert into comments (id, montage_id, user_id, body) values
  ('99999999-4444-4444-4444-444444444402', '99999999-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999912', 'svc grant test comment')
  on conflict (id) do nothing;
insert into reports (id, reporter_id, target_type, target_id, reason) values
  ('99999999-3333-3333-3333-333333333303', '99999999-9999-9999-9999-999999999912', 'comment', '99999999-4444-4444-4444-444444444402', 'svc grant test report')
  on conflict (id) do nothing;

set role service_role;

do $$
begin
  perform moderator_warn_user('99999999-9999-9999-9999-999999999912', 'service-role grant check');
  raise notice 'PASS: moderator_warn_user is callable by service_role';
exception
  when insufficient_privilege then
    raise exception 'FAIL: moderator_warn_user is not callable by service_role (%)', sqlerrm;
end $$;

do $$
begin
  perform moderator_suspend_user('99999999-9999-9999-9999-999999999912', 'service-role grant check');
  raise notice 'PASS: moderator_suspend_user is callable by service_role';
exception
  when insufficient_privilege then
    raise exception 'FAIL: moderator_suspend_user is not callable by service_role (%)', sqlerrm;
end $$;

do $$
begin
  perform moderator_reinstate_user('99999999-9999-9999-9999-999999999912', 'service-role grant check');
  raise notice 'PASS: moderator_reinstate_user is callable by service_role';
exception
  when insufficient_privilege then
    raise exception 'FAIL: moderator_reinstate_user is not callable by service_role (%)', sqlerrm;
end $$;

do $$
begin
  perform moderator_remove_content('comment', '99999999-4444-4444-4444-444444444402', 'service-role grant check');
  raise notice 'PASS: moderator_remove_content is callable by service_role';
exception
  when insufficient_privilege then
    raise exception 'FAIL: moderator_remove_content is not callable by service_role (%)', sqlerrm;
end $$;

do $$
begin
  perform moderator_resolve_report('99999999-3333-3333-3333-333333333303', 'actioned', 'service-role grant check');
  raise notice 'PASS: moderator_resolve_report is callable by service_role';
exception
  when insufficient_privilege then
    raise exception 'FAIL: moderator_resolve_report is not callable by service_role (%)', sqlerrm;
end $$;

reset role;

-- Confirm the account_status/comment/report side effects actually landed
-- (not just that the call didn't error) — suspend then reinstate leaves
-- the account back at 'active', matching the runbook's real sequence.
do $$
declare v_status text; v_comment_status text; v_report_status text;
begin
  select account_status into v_status from profiles where id = '99999999-9999-9999-9999-999999999912';
  if v_status <> 'active' then raise exception 'FAIL: expected account_status active after suspend+reinstate, got %', v_status; end if;

  select moderation_status into v_comment_status from comments where id = '99999999-4444-4444-4444-444444444402';
  if v_comment_status <> 'removed' then raise exception 'FAIL: expected comment moderation_status removed, got %', v_comment_status; end if;

  select status into v_report_status from reports where id = '99999999-3333-3333-3333-333333333303';
  if v_report_status <> 'actioned' then raise exception 'FAIL: expected report status actioned, got %', v_report_status; end if;

  raise notice 'PASS: all five service-role calls actually took effect, not just avoided an error';
end $$;

select 'ALL MODERATOR RPC SERVICE-ROLE GRANT TESTS PASSED' as result;
