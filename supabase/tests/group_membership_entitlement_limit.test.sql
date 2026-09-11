-- Proves create_group() and join_group_by_code() actually enforce the
-- entitlement-based active-group cap (2 free / 10 plus) server-side, not
-- just as a client-side UI hint (groups/index.tsx disabling its buttons).
-- See 20260903000000_group_membership_entitlement_limit.sql: reproduced
-- against a real Postgres instance before this fix that a fresh free-tier
-- user could create/join unlimited groups via direct RPC calls.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777801', 'free-creator@test.dayline.app'),
  ('77777777-7777-7777-7777-777777777802', 'free-joiner@test.dayline.app'),
  ('77777777-7777-7777-7777-777777777803', 'plus-creator@test.dayline.app'),
  ('77777777-7777-7777-7777-777777777811', 'owner1@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) select id, email from auth.users
  where id in (
    '77777777-7777-7777-7777-777777777801', '77777777-7777-7777-7777-777777777802',
    '77777777-7777-7777-7777-777777777803', '77777777-7777-7777-7777-777777777811'
  )
  on conflict (id) do nothing;

insert into subscriptions (user_id, tier, status, entitlement) values
  ('77777777-7777-7777-7777-777777777803', 'plus', 'active', 'plus');

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

-- ---------------------------------------------------------------------
-- create_group(): a free user (no subscription row -> current_entitlement()
-- = 'free') can create exactly 2 groups, and a 3rd is rejected.
-- ---------------------------------------------------------------------
set role authenticated;
select test_login('77777777-7777-7777-7777-777777777801');

do $$
begin
  perform create_group('free creator group 1');
  perform create_group('free creator group 2');
  raise notice 'PASS: a free user can create up to 2 groups';
end $$;

do $$
begin
  begin
    perform create_group('free creator group 3');
    raise exception 'FAIL: a free user created a 3rd group past the maxActiveGroups=2 limit';
  exception
    when others then
      if sqlerrm <> 'group_limit_reached' then
        raise exception 'FAIL: expected group_limit_reached, got %', sqlerrm;
      end if;
      raise notice 'PASS: create_group() rejects a free user''s 3rd group with group_limit_reached';
  end;
end $$;

-- ---------------------------------------------------------------------
-- join_group_by_code(): a free user already at 2 active groups (via
-- create_group above) is rejected joining a 3rd via invite code too, not
-- just blocked from creating one directly.
-- ---------------------------------------------------------------------
select test_login('77777777-7777-7777-7777-777777777811');
select g.invite_code as owner1_code from create_group('owner1''s group') g \gset
select set_config('t.owner1_code', :'owner1_code', false);

select test_login('77777777-7777-7777-7777-777777777801'); -- back to the free creator, already at 2 groups
do $$
declare v_result jsonb;
begin
  select join_group_by_code(current_setting('t.owner1_code')) into v_result;
  if (v_result->>'ok')::boolean then
    raise exception 'FAIL: a free user at their 2-group limit was allowed to join a 3rd group';
  elsif v_result->>'error' <> 'group_limit_reached' then
    raise exception 'FAIL: expected group_limit_reached, got %', v_result->>'error';
  end if;
  raise notice 'PASS: join_group_by_code() rejects a free user''s 3rd group with group_limit_reached';
end $$;

-- ---------------------------------------------------------------------
-- Sanity: a fresh free user (0 groups) joining via code still works —
-- the fix only rejects at-or-over the limit, not every join.
-- ---------------------------------------------------------------------
select test_login('77777777-7777-7777-7777-777777777802');
do $$
declare v_result jsonb;
begin
  select join_group_by_code(current_setting('t.owner1_code')) into v_result;
  if not (v_result->>'ok')::boolean then
    raise exception 'FAIL: a fresh free user under the limit was rejected joining: %', v_result->>'error';
  end if;
  raise notice 'PASS: a free user under the limit can still join normally';
end $$;

-- ---------------------------------------------------------------------
-- A 'plus' user is not capped at 2 — the same 3rd create_group call that
-- rejected the free user above succeeds for a plus entitlement.
-- ---------------------------------------------------------------------
select test_login('77777777-7777-7777-7777-777777777803');
do $$
declare i int;
begin
  for i in 1..3 loop
    perform create_group('plus creator group ' || i);
  end loop;
  raise notice 'PASS: a plus user is not capped at the free-tier limit of 2 groups';
end $$;

reset role;
select 'ALL GROUP MEMBERSHIP ENTITLEMENT LIMIT TESTS PASSED' as result;
