-- Proves 20260901030000_moderator_resolve_report.sql's moderator_resolve_report()
-- actually resolves a report's status/audit fields and logs a matching
-- moderation_actions row atomically, rejects an unsupported status and
-- a nonexistent report, and is not callable by the authenticated role.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999906', 'mrr-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999906', 'mrr-test')
  on conflict (id) do nothing;
insert into reports (id, reporter_id, target_type, target_id, reason) values
  ('99999999-3333-3333-3333-333333333301', '99999999-9999-9999-9999-999999999906', 'clip', '99999999-9999-9999-9999-999999999906', 'inappropriate')
  on conflict (id) do nothing;
insert into reports (id, reporter_id, target_type, target_id, reason) values
  ('99999999-3333-3333-3333-333333333302', '99999999-9999-9999-9999-999999999906', 'clip', '99999999-9999-9999-9999-999999999906', 'false alarm')
  on conflict (id) do nothing;

-- Run as plain postgres, no request.jwt.claim.sub set — the real
-- service-role calling convention (auth.uid() is null).
select moderator_resolve_report('99999999-3333-3333-3333-333333333301', 'actioned', 'removed the clip');
do $$
declare v_status text; v_notes text; v_resolved_at timestamptz;
begin
  select status, resolution_notes, resolved_at into v_status, v_notes, v_resolved_at
    from reports where id = '99999999-3333-3333-3333-333333333301';
  if v_status <> 'actioned' or v_notes <> 'removed the clip' or v_resolved_at is null then
    raise exception 'FAIL: report was not resolved as actioned, got status=% notes=% resolved_at=%', v_status, v_notes, v_resolved_at;
  end if;
  raise notice 'PASS: moderator_resolve_report resolves a report as actioned';
end $$;

select moderator_resolve_report('99999999-3333-3333-3333-333333333302', 'dismissed', 'no violation found');
do $$
declare v_status text;
begin
  select status into v_status from reports where id = '99999999-3333-3333-3333-333333333302';
  if v_status <> 'dismissed' then raise exception 'FAIL: report was not dismissed, got %', v_status; end if;
  raise notice 'PASS: moderator_resolve_report resolves a report as dismissed';
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from moderation_actions
    where target_type = 'report' and target_id in ('99999999-3333-3333-3333-333333333301', '99999999-3333-3333-3333-333333333302')
    and action in ('resolve_report', 'dismiss_report');
  if v_n <> 2 then raise exception 'FAIL: expected 2 moderation_actions rows, got %', v_n; end if;
  raise notice 'PASS: each resolution logs the matching moderation_actions row';
end $$;

do $$
begin
  begin
    perform moderator_resolve_report('99999999-3333-3333-3333-333333333301', 'reviewing', 'not a terminal status');
    raise exception 'FAIL: an unsupported status should have been rejected';
  exception
    when others then
      if sqlerrm <> 'unsupported_status' then raise exception 'FAIL: expected unsupported_status, got %', sqlerrm; end if;
      raise notice 'PASS: an unsupported status is rejected';
  end;
end $$;

do $$
begin
  begin
    perform moderator_resolve_report(gen_random_uuid(), 'dismissed', 'no such report');
    raise exception 'FAIL: a nonexistent report id should have been rejected';
  exception
    when others then
      if sqlerrm <> 'not_found' then raise exception 'FAIL: expected not_found, got %', sqlerrm; end if;
      raise notice 'PASS: a nonexistent report id is rejected';
  end;
end $$;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;
set role authenticated;
select test_login('99999999-9999-9999-9999-999999999906');
do $$
begin
  begin
    perform moderator_resolve_report('99999999-3333-3333-3333-333333333301', 'actioned', 'client attempt');
    raise exception 'FAIL: an authenticated client should not be able to call moderator_resolve_report';
  exception
    when insufficient_privilege then
      raise notice 'PASS: moderator_resolve_report is not callable by the authenticated role';
  end;
end $$;
reset role;

select 'ALL MODERATOR RESOLVE REPORT TESTS PASSED' as result;
