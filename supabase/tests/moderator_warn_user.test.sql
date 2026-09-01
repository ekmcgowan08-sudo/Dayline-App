-- Proves 20260901050000_moderator_warn_user.sql's moderator_warn_user()
-- logs a moderation_actions row and is not callable by the authenticated
-- role — the last moderation action given the same uniform RPC pattern
-- as remove_content/suspend_user/resolve_report.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999909', 'warn-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999909', 'warn-test')
  on conflict (id) do nothing;

-- Run as plain postgres, no request.jwt.claim.sub set — the real
-- service-role calling convention (auth.uid() is null).
select moderator_warn_user('99999999-9999-9999-9999-999999999909', 'first offense, minor');
do $$
declare v_n int; v_reason text;
begin
  select count(*), max(reason) into v_n, v_reason from moderation_actions
    where target_type = 'user' and target_id = '99999999-9999-9999-9999-999999999909' and action = 'warn';
  if v_n <> 1 or v_reason <> 'first offense, minor' then
    raise exception 'FAIL: expected exactly one warn row with the given reason, got count=% reason=%', v_n, v_reason;
  end if;
  raise notice 'PASS: moderator_warn_user logs a moderation_actions row';
end $$;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;
set role authenticated;
select test_login('99999999-9999-9999-9999-999999999909');
do $$
begin
  begin
    perform moderator_warn_user('99999999-9999-9999-9999-999999999909', 'client attempt');
    raise exception 'FAIL: an authenticated client should not be able to call moderator_warn_user';
  exception
    when insufficient_privilege then
      raise notice 'PASS: moderator_warn_user is not callable by the authenticated role';
  end;
end $$;
reset role;

select 'ALL MODERATOR WARN USER TESTS PASSED' as result;
