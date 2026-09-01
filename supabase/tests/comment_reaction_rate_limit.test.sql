-- Proves 20260901000000_comment_reaction_rate_limiting.sql actually blocks
-- excess comment/reaction inserts via check_rate_limit() embedded in the
-- RLS WITH CHECK clause (same mechanism as report_hardening.sql's report
-- rate limit, proven by S5 in rls_security.test.sql for a different
-- table) — not just that the migration applies cleanly.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999903', 'rl-test@test.dayline.app')
  on conflict (id) do nothing;
insert into profiles (id, display_name) values
  ('99999999-9999-9999-9999-999999999903', 'rl-test')
  on conflict (id) do nothing;
insert into montages (id, user_id, session_date, status, storage_path) values
  ('99999999-8888-8888-8888-888888888803', '99999999-9999-9999-9999-999999999903', current_date, 'ready', 'p/rl.mp4')
  on conflict (id) do nothing;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;
select test_login('99999999-9999-9999-9999-999999999903');

do $$
declare i int;
begin
  for i in 1..20 loop
    insert into comments (montage_id, user_id, body)
    values ('99999999-8888-8888-8888-888888888803', '99999999-9999-9999-9999-999999999903', 'comment ' || i);
  end loop;
  raise notice 'PASS: 20 comments within the window all succeeded';
end $$;

do $$
begin
  begin
    insert into comments (montage_id, user_id, body)
    values ('99999999-8888-8888-8888-888888888803', '99999999-9999-9999-9999-999999999903', 'one too many');
    raise exception 'FAIL: a 21st comment within the same 5-minute window should have been rate-limited';
  exception
    when insufficient_privilege then
      raise notice 'PASS: a 21st rapid comment is rate-limited';
  end;
end $$;

-- reactions has a unique (montage_id, user_id, emoji) constraint, so
-- reacting to the same montage 30 times isn't possible even outside the
-- rate limit — 30 distinct montages models a user quickly reacting while
-- catching up on their feed, which is the realistic way to hit this limit.
reset role;
do $$
declare i int;
begin
  for i in 1..31 loop
    insert into montages (id, user_id, session_date, status, storage_path)
    values (
      ('99999999-6666-6666-6666-' || lpad(i::text, 12, '0'))::uuid,
      '99999999-9999-9999-9999-999999999903',
      current_date - i,
      'ready',
      'p/rl-' || i || '.mp4'
    )
    on conflict (id) do nothing;
  end loop;
end $$;
set role authenticated;
select test_login('99999999-9999-9999-9999-999999999903');

do $$
declare i int;
begin
  for i in 1..30 loop
    insert into reactions (montage_id, user_id, emoji)
    values (('99999999-6666-6666-6666-' || lpad(i::text, 12, '0'))::uuid, '99999999-9999-9999-9999-999999999903', '❤️');
  end loop;
  raise notice 'PASS: 30 reactions within the window all succeeded';
end $$;

do $$
begin
  begin
    insert into reactions (montage_id, user_id, emoji)
    values (('99999999-6666-6666-6666-' || lpad(31::text, 12, '0'))::uuid, '99999999-9999-9999-9999-999999999903', '❤️');
    raise exception 'FAIL: a 31st reaction within the same 5-minute window should have been rate-limited';
  exception
    when insufficient_privilege then
      raise notice 'PASS: a 31st rapid reaction is rate-limited';
  end;
end $$;

reset role;
select 'ALL COMMENT/REACTION RATE LIMIT TESTS PASSED' as result;
