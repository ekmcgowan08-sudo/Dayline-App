-- Groups hardening: admin role, invite-code lifecycle (expire/regenerate/
-- revoke), rate-limited/atomic invite-code redemption, membership-cap
-- enforcement that can't race, explicit per-clip group contributions
-- (privacy default: nothing is shared without an explicit user action),
-- and audited membership events.

-- ---------------------------------------------------------------------
-- groups: invite-code lifecycle metadata
-- ---------------------------------------------------------------------
alter table groups
  add column if not exists invite_code_status text not null default 'active'
    check (invite_code_status in ('active', 'revoked')),
  add column if not exists invite_code_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------
-- group_members: admin role
-- ---------------------------------------------------------------------
alter table group_members drop constraint if exists group_members_role_check;
alter table group_members add constraint group_members_role_check check (role in ('owner', 'admin', 'member'));

-- The baseline's "members see membership" policy on group_members queried
-- group_members from within its own USING clause, which Postgres evaluates
-- recursively against the same RLS-protected table — this throws
-- "infinite recursion detected in policy for relation group_members" the
-- moment anyone selects from it. Confirmed by actually running the RLS
-- test suite against a real Postgres instance, not just reading the SQL.
-- Fixed with a SECURITY DEFINER helper, which runs as the (superuser)
-- function owner and therefore bypasses RLS internally instead of
-- re-triggering the policy it's used from.
create or replace function is_group_member(p_group_id uuid, p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id);
$$;
grant execute on function is_group_member(uuid, uuid) to authenticated;

drop policy if exists "members see membership" on group_members;
create policy "members see membership" on group_members for select using (
  is_group_member(group_members.group_id, auth.uid())
);

create table if not exists group_membership_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event text not null check (event in ('joined', 'left', 'removed', 'role_changed')),
  created_at timestamptz not null default now()
);
alter table group_membership_events enable row level security;
create policy "members read their group's events" on group_membership_events for select using (
  group_id in (select group_id from group_members where user_id = auth.uid())
  or user_id = auth.uid()
);

-- ---------------------------------------------------------------------
-- invite_code_attempts: rate-limiting ledger for brute-force protection.
-- Not exposed to the client at all (no policies => authenticated role has
-- zero access; only SECURITY DEFINER functions and the service role touch it).
-- ---------------------------------------------------------------------
create table if not exists invite_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_code text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists invite_code_attempts_user_idx on invite_code_attempts(user_id, created_at desc);
alter table invite_code_attempts enable row level security;

-- ---------------------------------------------------------------------
-- group_contributions: the ONLY mechanism by which a clip becomes eligible
-- for a group montage. A row here is an explicit, revocable opt-in by the
-- clip's owner. Raw clip storage objects are never exposed to other group
-- members through this table (RLS below only lets the contributor see/
-- manage their own rows) — group members only ever see the rendered
-- montage output.
-- ---------------------------------------------------------------------
create table if not exists group_contributions (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references clips(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  contributed_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clip_id, group_id)
);
create index if not exists group_contributions_group_idx on group_contributions(group_id);
alter table group_contributions enable row level security;
create policy "contributor manages own contributions" on group_contributions for all using (
  auth.uid() = contributed_by
) with check (
  auth.uid() = contributed_by
  and clip_id in (select id from clips where user_id = auth.uid())
  and group_id in (select group_id from group_members where user_id = auth.uid())
);

-- ---------------------------------------------------------------------
-- Replace "creator manages group" with owner-or-admin, and tighten the
-- membership-visibility policy to only apply to non-removed members
-- (removal now hard-deletes the row, so this is naturally satisfied, but
-- the policy is restated here for clarity after the role check change).
-- ---------------------------------------------------------------------
drop policy if exists "creator manages group" on groups;
create policy "owner or admin update group" on groups for update using (
  id in (select group_id from group_members where user_id = auth.uid() and role in ('owner', 'admin'))
);

-- ---------------------------------------------------------------------
-- Helper: mutual block check used across reactions/comments/join policies.
-- ---------------------------------------------------------------------
create or replace function blocked_between(a uuid, b uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function group_has_block_with(p_group_id uuid, p_user_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from group_members gm where gm.group_id = p_group_id and blocked_between(gm.user_id, p_user_id)
  );
$$;

-- ---------------------------------------------------------------------
-- Cryptographically strong, unambiguous (no 0/O/1/I/L) 6-character invite
-- codes. Uses pgcrypto's gen_random_bytes, not the non-cryptographic
-- random() the recovered client-side generator used.
-- ---------------------------------------------------------------------
create or replace function generate_invite_code() returns text
language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 32 unambiguous chars, 256 % 32 = 0 (no modulo bias)
  result text := '';
  raw bytea := gen_random_bytes(6);
  i int;
begin
  for i in 0..5 loop
    result := result || substr(chars, (get_byte(raw, i) % length(chars)) + 1, 1);
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- create_group: atomic create + owner membership + collision retry.
-- ---------------------------------------------------------------------
create or replace function create_group(p_name text) returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_group groups;
  v_attempts int := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'group_name_required';
  end if;

  loop
    v_code := generate_invite_code();
    begin
      insert into groups (name, created_by, invite_code, max_members)
      values (trim(p_name), auth.uid(), v_code, 10)
      returning * into v_group;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 10 then
        raise exception 'invite_code_collision_retry_exceeded';
      end if;
    end;
  end loop;

  insert into group_members (group_id, user_id, role) values (v_group.id, auth.uid(), 'owner');
  insert into group_membership_events (group_id, user_id, actor_id, event) values (v_group.id, auth.uid(), auth.uid(), 'joined');
  return v_group;
end;
$$;
revoke all on function create_group(text) from public;
grant execute on function create_group(text) to authenticated;

-- ---------------------------------------------------------------------
-- join_group_by_code: rate-limited, atomic, race-free join.
--
-- Returns jsonb ({"ok": true, "group": {...}} | {"ok": false, "error": "..."})
-- instead of raising exceptions for expected business-logic failures. This
-- is deliberate, not stylistic: a Postgres function that INSERTs a
-- rate-limit ledger row and then RAISEs is pointless — RAISE aborts the
-- current transaction (or, if a caller wraps the call in its own
-- exception handler, rolls back to the implicit savepoint around it),
-- undoing that very INSERT. In production PostgREST also runs each RPC
-- call in its own transaction, so an exception there rolls back the
-- *entire* call including the log write. The result: a naive
-- raise-on-failure version of this function can NEVER accumulate a
-- rate-limit history, because every logged failure erases itself. This
-- was caught by actually running supabase/tests/rls_security.test.sql
-- (S5) against a real Postgres instance — the first version of this
-- function passed a read-through-the-SQL review but silently never
-- rate-limited anything. Returning normally on expected failures lets the
-- ledger insert commit as part of a successful call. `not_authenticated`
-- is the one case still raised: it indicates a caller bug (missing JWT),
-- not a user-facing outcome the app needs to branch on.
--
-- `select ... for update` on the target group row serializes concurrent
-- joins to the SAME group, so the 10-member cap check below can never race.
-- ---------------------------------------------------------------------
create or replace function join_group_by_code(p_code text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_recent_attempts int;
  v_member_count int;
  v_normalized_code text := upper(trim(p_code));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select count(*) into v_recent_attempts
  from invite_code_attempts
  where user_id = auth.uid() and created_at > now() - interval '10 minutes';

  if v_recent_attempts >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select * into v_group from groups
  where invite_code = v_normalized_code
    and invite_code_status = 'active'
    and (invite_code_expires_at is null or invite_code_expires_at > now())
  for update;

  if not found then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired_code');
  end if;

  if exists (select 1 from group_members where group_id = v_group.id and user_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'group', to_jsonb(v_group)); -- already a member: idempotent success
  end if;

  if group_has_block_with(v_group.id, auth.uid()) then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'blocked_relationship');
  end if;

  select count(*) into v_member_count from group_members where group_id = v_group.id;
  if v_member_count >= v_group.max_members then
    insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, false);
    return jsonb_build_object('ok', false, 'error', 'group_full');
  end if;

  insert into group_members (group_id, user_id, role) values (v_group.id, auth.uid(), 'member');
  insert into group_membership_events (group_id, user_id, actor_id, event) values (v_group.id, auth.uid(), auth.uid(), 'joined');
  insert into invite_code_attempts (user_id, attempted_code, succeeded) values (auth.uid(), v_normalized_code, true);
  return jsonb_build_object('ok', true, 'group', to_jsonb(v_group));
end;
$$;
revoke all on function join_group_by_code(text) from public;
grant execute on function join_group_by_code(text) to authenticated;

-- ---------------------------------------------------------------------
-- regenerate / revoke invite codes (owner or admin only).
-- ---------------------------------------------------------------------
create or replace function regenerate_invite_code(p_group_id uuid) returns groups
language plpgsql security definer set search_path = public as $$
declare
  v_group groups;
  v_code text;
  v_attempts int := 0;
begin
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'not_authorized';
  end if;
  loop
    v_code := generate_invite_code();
    begin
      update groups set invite_code = v_code, invite_code_status = 'active', invite_code_expires_at = null, updated_at = now()
      where id = p_group_id
      returning * into v_group;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 10 then raise exception 'invite_code_collision_retry_exceeded'; end if;
    end;
  end loop;
  return v_group;
end;
$$;
revoke all on function regenerate_invite_code(uuid) from public;
grant execute on function regenerate_invite_code(uuid) to authenticated;

create or replace function revoke_invite_code(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'not_authorized';
  end if;
  update groups set invite_code_status = 'revoked', updated_at = now() where id = p_group_id;
end;
$$;
revoke all on function revoke_invite_code(uuid) from public;
grant execute on function revoke_invite_code(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- remove_group_member / leave_group / delete_group
-- ---------------------------------------------------------------------
create or replace function remove_group_member(p_group_id uuid, p_target_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target_role text;
begin
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'not_authorized';
  end if;
  select role into v_target_role from group_members where group_id = p_group_id and user_id = p_target_user_id;
  if v_target_role is null then
    raise exception 'not_a_member';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;
  delete from group_members where group_id = p_group_id and user_id = p_target_user_id;
  insert into group_membership_events (group_id, user_id, actor_id, event) values (p_group_id, p_target_user_id, auth.uid(), 'removed');
end;
$$;
revoke all on function remove_group_member(uuid, uuid) from public;
grant execute on function remove_group_member(uuid, uuid) to authenticated;

create or replace function leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_member_count int;
begin
  select role into v_role from group_members where group_id = p_group_id and user_id = auth.uid();
  if v_role is null then
    raise exception 'not_a_member';
  end if;

  select count(*) into v_member_count from group_members where group_id = p_group_id;

  if v_role = 'owner' and v_member_count > 1 then
    raise exception 'owner_must_transfer_or_delete';
  end if;

  delete from group_members where group_id = p_group_id and user_id = auth.uid();
  insert into group_membership_events (group_id, user_id, actor_id, event) values (p_group_id, auth.uid(), auth.uid(), 'left');

  if v_role = 'owner' and v_member_count <= 1 then
    delete from groups where id = p_group_id; -- last member leaving deletes the group; cascades montages/contributions
  end if;
end;
$$;
revoke all on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;

create or replace function delete_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'not_authorized';
  end if;
  delete from groups where id = p_group_id;
end;
$$;
revoke all on function delete_group(uuid) from public;
grant execute on function delete_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- contribute_clip_to_group / withdraw_clip_from_group: thin RPC wrappers
-- kept for a clean client API; the RLS policy above is what actually
-- enforces the rule, these just give a friendlier error surface.
-- ---------------------------------------------------------------------
create or replace function contribute_clip_to_group(p_clip_id uuid, p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from clips where id = p_clip_id and user_id = auth.uid()) then
    raise exception 'not_your_clip';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  insert into group_contributions (clip_id, group_id, contributed_by)
  values (p_clip_id, p_group_id, auth.uid())
  on conflict (clip_id, group_id) do nothing;
end;
$$;
revoke all on function contribute_clip_to_group(uuid, uuid) from public;
grant execute on function contribute_clip_to_group(uuid, uuid) to authenticated;
