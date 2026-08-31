-- Automated RLS/security proofs required by the project spec. Run against a
-- freshly migrated database (see run_all.sh, which calls run_migrations.sh
-- first). Every scenario ends in either `RAISE NOTICE 'PASS: ...'` or
-- `RAISE EXCEPTION 'FAIL: ...'`; psql is invoked with ON_ERROR_STOP=1 so the
-- whole run fails loudly (non-zero exit) on the first broken guarantee.
--
-- Identity is impersonated by setting the `request.jwt.claim.sub` GUC (our
-- stub auth.uid() reads it) while running as the `authenticated` role,
-- which owns none of these tables and has no BYPASSRLS — i.e. RLS is
-- actually enforced for every statement below, exactly as PostgREST would
-- enforce it in production.
--
-- NOTE on variable passing: psql's `:'var'` interpolation does NOT reach
-- inside dollar-quoted (`do $$ ... $$`) bodies. Every value a DO block
-- needs is therefore first stashed into a session GUC with `set_config`
-- (which DOES get psql substitution, since it's a plain top-level
-- statement) and read back inside the block with `current_setting`.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- Fixtures (as postgres, before dropping to the authenticated role)
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dayline.app'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dayline.app'),
  ('33333333-3333-3333-3333-333333333333', 'carol@test.dayline.app'),
  ('44444444-4444-4444-4444-444444444444', 'dave@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555501', 'f1@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555502', 'f2@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555503', 'f3@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555504', 'f4@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555505', 'f5@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555506', 'f6@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555507', 'f7@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555508', 'f8@test.dayline.app'),
  ('55555555-5555-5555-5555-555555555509', 'f9@test.dayline.app');

insert into profiles (id, display_name) select id, email from auth.users;

create or replace function test_login(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

set role authenticated;

-- ---------------------------------------------------------------------
-- S1 — a user cannot read, update, or delete another user's raw clips.
-- ---------------------------------------------------------------------
select test_login('11111111-1111-1111-1111-111111111111'); -- alice
insert into clips (user_id, storage_path, duration_ms, client_capture_id)
  values (auth.uid(), '11111111-1111-1111-1111-111111111111/c1.mp4', 5000, gen_random_uuid());

select test_login('22222222-2222-2222-2222-222222222222'); -- bob

do $$
declare v_n int;
begin
  select count(*) into v_n from clips where user_id = '11111111-1111-1111-1111-111111111111';
  if v_n <> 0 then raise exception 'FAIL: S1 bob could read alice''s clip'; end if;

  update clips set duration_ms = 1 where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: S1 bob updated alice''s clip'; end if;

  delete from clips where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: S1 bob deleted alice''s clip'; end if;

  raise notice 'PASS: S1 user A cannot read/alter user B raw clips';
end $$;

-- ---------------------------------------------------------------------
-- S2 — nonmember cannot read a group montage; a removed member loses access.
-- ---------------------------------------------------------------------
select test_login('11111111-1111-1111-1111-111111111111'); -- alice
select g.id as g1_id, g.invite_code as g1_code from create_group('Close Friends') g \gset
select set_config('t.g1_code', :'g1_code', false);

select test_login('22222222-2222-2222-2222-222222222222'); -- bob
do $$
declare v_result jsonb;
begin
  select join_group_by_code(current_setting('t.g1_code')) into v_result;
  if not (v_result->>'ok')::boolean then raise exception 'FAIL: S2 bob failed to join with a valid code: %', v_result->>'error'; end if;
end $$;

-- Simulate the worker having rendered the group montage (service role write).
reset role;
insert into montages (id, group_id, session_date, status, storage_path)
  values (gen_random_uuid(), :'g1_id', current_date, 'ready', 'montages/group/g1/render.mp4')
  returning id as m1_id \gset
set role authenticated;
select set_config('t.m1_id', :'m1_id', false);

select test_login('33333333-3333-3333-3333-333333333333'); -- carol, never joined g1
do $$
declare v_n int;
begin
  select count(*) into v_n from montages where id = current_setting('t.m1_id')::uuid;
  if v_n <> 0 then raise exception 'FAIL: S2 nonmember (carol) could read group montage'; end if;
  raise notice 'PASS: S2 nonmember cannot read group montage';
end $$;

select test_login('22222222-2222-2222-2222-222222222222'); -- bob, a member
do $$
declare v_n int;
begin
  select count(*) into v_n from montages where id = current_setting('t.m1_id')::uuid;
  if v_n <> 1 then raise exception 'FAIL: S2 member (bob) could not read group montage'; end if;
end $$;

select test_login('11111111-1111-1111-1111-111111111111'); -- alice, owner, removes bob
select remove_group_member(:'g1_id', '22222222-2222-2222-2222-222222222222');

select test_login('22222222-2222-2222-2222-222222222222'); -- bob again, now removed
do $$
declare v_n int;
begin
  select count(*) into v_n from montages where id = current_setting('t.m1_id')::uuid;
  if v_n <> 0 then raise exception 'FAIL: S3 removed member (bob) still reads group montage'; end if;
  raise notice 'PASS: S3 removed member loses access to group montage';
end $$;

-- ---------------------------------------------------------------------
-- S4 — group membership cannot exceed 10 active members.
-- ---------------------------------------------------------------------
select test_login('11111111-1111-1111-1111-111111111111'); -- alice
select g.invite_code as g2_code from create_group('Cap Test') g \gset
select set_config('t.g2_code', :'g2_code', false);

do $$
declare
  v_code text := current_setting('t.g2_code');
  v_fillers uuid[] := array[
    '55555555-5555-5555-5555-555555555501','55555555-5555-5555-5555-555555555502',
    '55555555-5555-5555-5555-555555555503','55555555-5555-5555-5555-555555555504',
    '55555555-5555-5555-5555-555555555505','55555555-5555-5555-5555-555555555506',
    '55555555-5555-5555-5555-555555555507','55555555-5555-5555-5555-555555555508',
    '55555555-5555-5555-5555-555555555509'
  ];
  v_uid uuid;
  v_result jsonb;
begin
  foreach v_uid in array v_fillers loop
    perform test_login(v_uid);
    select join_group_by_code(v_code) into v_result;
    if not (v_result->>'ok')::boolean then
      raise exception 'FAIL: S4 filler % failed to join: %', v_uid, v_result->>'error';
    end if;
  end loop;
  raise notice 'PASS(setup): 9 fillers + owner = 10/10 members in Cap Test group';
end $$;

select test_login('44444444-4444-4444-4444-444444444444'); -- dave, the 11th
do $$
declare v_result jsonb;
begin
  select join_group_by_code(current_setting('t.g2_code')) into v_result;
  if (v_result->>'ok')::boolean then
    raise exception 'FAIL: S4 an 11th member was allowed to join a 10-member group';
  elsif v_result->>'error' <> 'group_full' then
    raise exception 'FAIL: S4 unexpected error: %', v_result->>'error';
  end if;
  raise notice 'PASS: S4 group membership cannot exceed 10 (group_full enforced)';
end $$;

-- ---------------------------------------------------------------------
-- S5 — invite-code brute-force protection (rate limiting).
-- ---------------------------------------------------------------------
-- Fresh identity for this scenario so earlier successful/failed joins by
-- other test users don't shift the threshold.
select test_login('44444444-4444-4444-4444-444444444444'); -- dave, already made exactly 1 prior attempt (S4's rejected 11th join)
do $$
declare
  i int;
  v_result jsonb;
  v_hit_rate_limit boolean := false;
begin
  for i in 1..21 loop
    select join_group_by_code('ZZZZZZ') into v_result; -- never a real code
    if (v_result->>'ok')::boolean then
      raise exception 'FAIL: S5 a nonexistent code was accepted on attempt %', i;
    elsif v_result->>'error' = 'rate_limited' then
      v_hit_rate_limit := true;
    elsif v_result->>'error' <> 'invalid_or_expired_code' then
      raise exception 'FAIL: S5 unexpected error on attempt %: %', i, v_result->>'error';
    end if;
  end loop;
  if not v_hit_rate_limit then raise exception 'FAIL: S5 21 rapid invalid attempts never triggered rate limiting'; end if;
  raise notice 'PASS: S5 invite-code brute-force protection enforced';
end $$;

-- ---------------------------------------------------------------------
-- S6 — a client cannot grant themselves a paid entitlement.
-- ---------------------------------------------------------------------
reset role;
insert into subscriptions (user_id, tier, status, entitlement) values
  ('11111111-1111-1111-1111-111111111111', 'free', 'active', 'free');
set role authenticated;

select test_login('11111111-1111-1111-1111-111111111111'); -- alice
do $$
declare v_n int;
begin
  update subscriptions set entitlement = 'plus', tier = 'plus' where user_id = auth.uid();
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: S6 client updated their own subscription to plus'; end if;
end $$;

select test_login('22222222-2222-2222-2222-222222222222'); -- bob, no subscription row yet
do $$
declare v_rejected boolean := false;
begin
  begin
    insert into subscriptions (user_id, tier, status, entitlement) values (auth.uid(), 'plus', 'active', 'plus');
  exception when others then
    v_rejected := true; -- any error here (RLS violation) is the expected, correct outcome
  end;
  if not v_rejected then raise exception 'FAIL: S6 client inserted their own paid subscription row'; end if;
  raise notice 'PASS: S6 client cannot self-grant a paid entitlement (insert+update both blocked)';
end $$;

-- ---------------------------------------------------------------------
-- S7 — a client cannot change moderation status on content.
-- ---------------------------------------------------------------------
reset role;
insert into montages (id, user_id, session_date, status, storage_path)
  values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', current_date, 'ready', 'montages/personal/alice/render.mp4')
  returning id as m2_id \gset
set role authenticated;

select test_login('11111111-1111-1111-1111-111111111111'); -- alice, montage owner
insert into comments (id, montage_id, user_id, body) values (gen_random_uuid(), :'m2_id', auth.uid(), 'love this day')
  returning id as cm1_id \gset
select set_config('t.cm1_id', :'cm1_id', false);

do $$
declare v_n int;
begin
  update comments set moderation_status = 'removed' where id = current_setting('t.cm1_id')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: S7 client updated moderation_status directly'; end if;
end $$;

select test_login('22222222-2222-2222-2222-222222222222'); -- bob, not the montage owner
do $$
declare v_rejected boolean := false;
begin
  begin
    perform moderate_delete_comment(current_setting('t.cm1_id')::uuid);
  exception when others then
    if sqlerrm = 'not_authorized' then
      v_rejected := true;
    else
      raise exception 'FAIL: S7 unexpected error: %', sqlerrm;
    end if;
  end;
  if not v_rejected then raise exception 'FAIL: S7 unauthorized user removed a comment via moderate_delete_comment'; end if;
end $$;

select test_login('11111111-1111-1111-1111-111111111111'); -- alice, authorized owner
select moderate_delete_comment(:'cm1_id');
do $$
declare v_n int;
begin
  select count(*) into v_n from comments where id = current_setting('t.cm1_id')::uuid;
  if v_n <> 0 then raise exception 'FAIL: S7 moderated comment still visible to its author'; end if;
  raise notice 'PASS: S7 moderation status is immutable by clients; only the authorized RPC path can remove content';
end $$;

-- ---------------------------------------------------------------------
-- S8 — blocking affects applicable queries and interactions.
-- ---------------------------------------------------------------------
select test_login('11111111-1111-1111-1111-111111111111'); -- alice
select g.id as g3_id, g.invite_code as g3_code from create_group('Blocking Test') g \gset
select g.invite_code as g4_code from create_group('Blocking Test 2') g \gset
select set_config('t.g4_code', :'g4_code', false);
select set_config('t.g3_code', :'g3_code', false);

select test_login('33333333-3333-3333-3333-333333333333'); -- carol
do $$
declare v_result jsonb;
begin
  select join_group_by_code(current_setting('t.g3_code')) into v_result;
  if not (v_result->>'ok')::boolean then raise exception 'FAIL: S8 setup — carol failed to join g3: %', v_result->>'error'; end if;
end $$;

reset role;
insert into montages (id, group_id, session_date, status, storage_path)
  values (gen_random_uuid(), :'g3_id', current_date, 'ready', 'montages/group/g3/render.mp4')
  returning id as m3_id \gset
set role authenticated;

select test_login('33333333-3333-3333-3333-333333333333'); -- carol comments
insert into comments (id, montage_id, user_id, body) values (gen_random_uuid(), :'m3_id', auth.uid(), 'so good')
  returning id as cm2_id \gset
select set_config('t.cm2_id', :'cm2_id', false);

select test_login('11111111-1111-1111-1111-111111111111'); -- alice can see it before blocking
do $$
declare v_n int;
begin
  select count(*) into v_n from comments where id = current_setting('t.cm2_id')::uuid;
  if v_n <> 1 then raise exception 'FAIL: S8 setup — alice should see carol''s comment before blocking'; end if;
end $$;

insert into blocks (blocker_id, blocked_id) values (auth.uid(), '33333333-3333-3333-3333-333333333333');

do $$
declare v_n int;
begin
  select count(*) into v_n from comments where id = current_setting('t.cm2_id')::uuid;
  if v_n <> 0 then raise exception 'FAIL: S8 alice still sees a blocked user''s comment'; end if;
  raise notice 'PASS: S8a blocking hides the blocked user''s comments from the blocker';
end $$;

select test_login('33333333-3333-3333-3333-333333333333'); -- carol, now blocked by alice
do $$
declare v_result jsonb;
begin
  select join_group_by_code(current_setting('t.g4_code')) into v_result;
  if (v_result->>'ok')::boolean then
    raise exception 'FAIL: S8 blocked user was allowed to join blocker''s other group';
  elsif v_result->>'error' <> 'blocked_relationship' then
    raise exception 'FAIL: S8 unexpected error: %', v_result->>'error';
  end if;
  raise notice 'PASS: S8b blocking prevents the blocked user from joining the blocker''s group';
end $$;

-- ---------------------------------------------------------------------
-- S9 — signed URL / private-media generation requires authorization:
-- a client's own session has no read access to the montages bucket at
-- all (only an Edge Function using the service role may read it, after
-- doing its own ownership/membership check — see supabase/functions/
-- get-montage-url). Clips bucket remains owner-scoped as a control case.
-- ---------------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('clips', '11111111-1111-1111-1111-111111111111/c1.mp4', '11111111-1111-1111-1111-111111111111'),
  ('montages', 'group/g3/render.mp4', null);
set role authenticated;

select test_login('11111111-1111-1111-1111-111111111111'); -- alice, owns the clip object
do $$
declare v_n int;
begin
  select count(*) into v_n from storage.objects where bucket_id = 'clips' and name = '11111111-1111-1111-1111-111111111111/c1.mp4';
  if v_n <> 1 then raise exception 'FAIL: S9 owner could not see their own clip storage object'; end if;

  select count(*) into v_n from storage.objects where bucket_id = 'montages';
  if v_n <> 0 then raise exception 'FAIL: S9 a client session could directly read the montages bucket (should require the service-role Edge Function path)'; end if;
  raise notice 'PASS: S9 montage signed-URL generation requires server-side authorization; clips remain owner-scoped';
end $$;

select test_login('22222222-2222-2222-2222-222222222222'); -- bob, not the clip owner
do $$
declare v_n int;
begin
  select count(*) into v_n from storage.objects where bucket_id = 'clips' and name = '11111111-1111-1111-1111-111111111111/c1.mp4';
  if v_n <> 0 then raise exception 'FAIL: S9 a non-owner could read another user''s clip storage object'; end if;
end $$;

reset role;
select 'ALL RLS SECURITY TESTS PASSED' as result;
