-- Proves 20260903090000_account_suspension_enforcement.sql: a user
-- suspended via moderator_suspend_user() is blocked from inserting a new
-- clip, posting a comment/reaction, and creating or joining a group, but
-- can still SELECT and DELETE their own existing clip. Reproduced against
-- a real Postgres instance before this fix existed: none of these were
-- blocked — moderator_suspend_user() set profiles.account_status =
-- 'suspended' and nothing else in the codebase ever read it.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888801', 'suspend-enforce-target@test.dayline.app'),
  ('88888888-8888-8888-8888-888888888802', 'suspend-enforce-other@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('88888888-8888-8888-8888-888888888801', 'suspend-enforce-target'),
  ('88888888-8888-8888-8888-888888888802', 'suspend-enforce-other')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

-- pre-suspension: seed a real clip owned by the target user, as an
-- ordinary authenticated insert, so we can later prove suspension does
-- NOT retroactively block access to content created before it.
set role authenticated;
select test_login('88888888-8888-8888-8888-888888888801');
insert into clips (user_id, storage_path, duration_ms, status)
  values ('88888888-8888-8888-8888-888888888801', 'suspend-enforce/pre.mp4', 5000, 'uploaded');
reset role;

-- Suspend via the real moderator RPC (service role, no request.jwt.claim.sub).
select moderator_suspend_user('88888888-8888-8888-8888-888888888801', 'CSAM report');
do $$
begin
  if (select account_status from profiles where id = '88888888-8888-8888-8888-888888888801') <> 'suspended' then
    raise exception 'FAIL: moderator_suspend_user did not set account_status = suspended';
  end if;
end $$;

set role authenticated;
select test_login('88888888-8888-8888-8888-888888888801');

do $$
begin
  begin
    insert into clips (user_id, storage_path, duration_ms, status)
      values ('88888888-8888-8888-8888-888888888801', 'suspend-enforce/blocked.mp4', 5000, 'uploaded');
    raise exception 'FAIL: a suspended user should not be able to insert a new clip';
  exception
    when insufficient_privilege then
      raise notice 'PASS: suspended user cannot insert a new clip (RLS)';
  end;
end $$;

do $$
begin
  begin
    perform create_group('suspended enforcement test group');
    raise exception 'FAIL: a suspended user should not be able to create a group';
  exception
    when others then
      if sqlerrm <> 'account_suspended' then
        raise exception 'FAIL: expected account_suspended, got %', sqlerrm;
      end if;
      raise notice 'PASS: suspended user cannot call create_group()';
  end;
end $$;

do $$
declare v_result jsonb;
begin
  select join_group_by_code('ZZZZZZ') into v_result;
  if v_result ->> 'error' <> 'account_suspended' then
    raise exception 'FAIL: expected join_group_by_code() to short-circuit with account_suspended, got %', v_result;
  end if;
  raise notice 'PASS: suspended user cannot call join_group_by_code()';
end $$;

-- Deliberately unaffected: read/delete of the target's own pre-existing content.
do $$
declare v_n int;
begin
  select count(*) into v_n from clips where storage_path = 'suspend-enforce/pre.mp4';
  if v_n <> 1 then
    raise exception 'FAIL: a suspended user should still be able to SELECT their own pre-existing clip';
  end if;
  raise notice 'PASS: suspended user can still SELECT their own pre-existing clip';
end $$;

do $$
declare v_n int;
begin
  delete from clips where storage_path = 'suspend-enforce/pre.mp4';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'FAIL: a suspended user should still be able to DELETE their own pre-existing clip';
  end if;
  raise notice 'PASS: suspended user can still DELETE their own pre-existing clip';
end $$;

reset role;

-- Comments/reactions INSERT policies: a suspended user cannot post a new
-- comment or reaction even on a montage they can otherwise see.
insert into montages (id, user_id, session_date, status, storage_path)
  values ('88888888-8888-8888-8888-888888888899'::uuid, '88888888-8888-8888-8888-888888888801', current_date, 'ready', 'suspend-enforce/montage.mp4')
  on conflict (id) do nothing;

set role authenticated;
select test_login('88888888-8888-8888-8888-888888888801');
do $$
begin
  begin
    insert into comments (montage_id, user_id, body)
      values ('88888888-8888-8888-8888-888888888899'::uuid, '88888888-8888-8888-8888-888888888801', 'hello');
    raise exception 'FAIL: a suspended user should not be able to insert a new comment';
  exception
    when insufficient_privilege then
      raise notice 'PASS: suspended user cannot insert a new comment (RLS)';
  end;
end $$;
do $$
begin
  begin
    insert into reactions (montage_id, user_id, emoji)
      values ('88888888-8888-8888-8888-888888888899'::uuid, '88888888-8888-8888-8888-888888888801', '🔥');
    raise exception 'FAIL: a suspended user should not be able to insert a new reaction';
  exception
    when insufficient_privilege then
      raise notice 'PASS: suspended user cannot insert a new reaction (RLS)';
  end;
end $$;
reset role;

-- An active (non-suspended) user is entirely unaffected by these policies.
set role authenticated;
select test_login('88888888-8888-8888-8888-888888888802');
select create_group('non-suspended user control group');
insert into clips (user_id, storage_path, duration_ms, status)
  values ('88888888-8888-8888-8888-888888888802', 'suspend-enforce/control.mp4', 5000, 'uploaded');
reset role;
do $$
declare v_n int;
begin
  select count(*) into v_n from clips where user_id = '88888888-8888-8888-8888-888888888802';
  if v_n <> 1 then
    raise exception 'FAIL: a non-suspended user should be unaffected by the suspension checks';
  end if;
  raise notice 'PASS: a non-suspended user is unaffected';
end $$;

select 'ALL ACCOUNT SUSPENSION ENFORCEMENT TESTS PASSED' as result;
