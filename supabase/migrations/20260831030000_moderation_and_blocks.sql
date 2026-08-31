-- Moderation foundation + closing two real RLS gaps found in the recovered
-- baseline:
--   1. group_members had a direct client INSERT/DELETE policy, which would
--      let a client bypass join_group_by_code()'s cap/rate-limit/blocking
--      checks by inserting into group_members directly. Membership changes
--      now go exclusively through the SECURITY DEFINER RPCs.
--   2. reactions/comments used `for all using (<montage access>)` with no
--      `with check`. Postgres reuses USING as the INSERT check when no
--      WITH CHECK is given, which here never constrained `user_id` — so any
--      member of a montage's audience could have inserted a comment/reaction
--      row claiming to be a *different* user_id. Replaced with explicit
--      per-operation policies.

-- ---------------------------------------------------------------------
-- group_members: mutations only via RPCs from here on.
-- ---------------------------------------------------------------------
drop policy if exists "user can join or leave" on group_members;
drop policy if exists "user can leave" on group_members;
-- select policy from the baseline is retained: members can see their own group's roster.

-- ---------------------------------------------------------------------
-- reactions: restrained, fixed set; explicit per-op policies with block
-- filtering in both directions (mutual hide, matching group_has_block_with).
-- ---------------------------------------------------------------------
alter table reactions drop constraint if exists reactions_emoji_check;
alter table reactions add constraint reactions_emoji_check
  check (emoji in ('❤️', '😂', '😮', '🥹', '🙌', '🔥'));
alter table reactions drop constraint if exists reactions_unique_per_user;
alter table reactions add constraint reactions_unique_per_user unique (montage_id, user_id, emoji);

drop policy if exists "group members react" on reactions;

create policy "read reactions on visible montages" on reactions for select using (
  montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
  and not blocked_between(auth.uid(), reactions.user_id)
);

create policy "insert own reaction on visible montages" on reactions for insert with check (
  auth.uid() = user_id
  and montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
);

create policy "delete own reaction" on reactions for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------
drop policy if exists "group members comment" on comments;

alter table comments
  add column if not exists deleted_at timestamptz,
  add column if not exists moderation_status text not null default 'ok'
    check (moderation_status in ('ok', 'flagged', 'removed'));

create policy "read comments on visible montages" on comments for select using (
  montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
  and not blocked_between(auth.uid(), comments.user_id)
  and deleted_at is null
);

create policy "insert own comment on visible montages" on comments for insert with check (
  auth.uid() = user_id
  and length(trim(body)) > 0
  and length(body) <= 500
  and montage_id in (
    select id from montages
    where user_id = auth.uid() or group_id in (select group_id from group_members where user_id = auth.uid())
  )
);

-- Comment deletion rule: the author can delete their own comment; a
-- personal-montage owner or a group owner/admin can remove a comment on
-- their content (moderation), which soft-deletes it (audit trail kept).
create policy "author deletes own comment" on comments for delete using (auth.uid() = user_id);

create or replace function moderate_delete_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_montage montages;
  v_authorized boolean := false;
begin
  select m.* into v_montage from comments c join montages m on m.id = c.montage_id where c.id = p_comment_id;
  if v_montage.id is null then raise exception 'not_found'; end if;

  if v_montage.user_id = auth.uid() then
    v_authorized := true;
  elsif v_montage.group_id is not null and exists (
    select 1 from group_members where group_id = v_montage.group_id and user_id = auth.uid() and role in ('owner','admin')
  ) then
    v_authorized := true;
  end if;

  if not v_authorized then raise exception 'not_authorized'; end if;

  update comments set deleted_at = now(), moderation_status = 'removed' where id = p_comment_id;
  insert into moderation_actions (actor_id, target_type, target_id, action, reason)
    values (auth.uid(), 'comment', p_comment_id, 'remove_content', 'moderator_delete');
end;
$$;
revoke all on function moderate_delete_comment(uuid) from public;
grant execute on function moderate_delete_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- reports: client can file and read their own; status/resolution is
-- moderator-only (service role — no client update/delete policy at all).
-- ---------------------------------------------------------------------
alter table reports
  add column if not exists status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolution_notes text,
  add column if not exists resolved_at timestamptz;

create policy "read own filed reports" on reports for select using (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------
-- moderation_actions: append-only audit log of sensitive actions
-- (content removal, suspension, reinstatement, report resolution). No
-- client policies at all — written only by SECURITY DEFINER functions or
-- the service role (a future admin tool), read only via that same path.
-- ---------------------------------------------------------------------
create table if not exists moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('user', 'clip', 'montage', 'comment', 'group', 'report')),
  target_id uuid not null,
  action text not null check (
    action in ('warn', 'remove_content', 'suspend_user', 'reinstate_user', 'dismiss_report', 'resolve_report')
  ),
  reason text,
  created_at timestamptz not null default now()
);
alter table moderation_actions enable row level security;
create index if not exists moderation_actions_target_idx on moderation_actions(target_type, target_id);

-- ---------------------------------------------------------------------
-- suspend/reinstate a user account. Callable only by an internal
-- moderator context (the service role, from the moderation tooling
-- described in docs/MODERATION_RUNBOOK.md) — no authenticated-role grant,
-- so a client can never call this even if they knew the function name.
-- ---------------------------------------------------------------------
create or replace function moderator_suspend_user(p_user_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set account_status = 'suspended', updated_at = now() where id = p_user_id;
  insert into moderation_actions (actor_id, target_type, target_id, action, reason)
    values (auth.uid(), 'user', p_user_id, 'suspend_user', p_reason);
end;
$$;
revoke all on function moderator_suspend_user(uuid, text) from public, authenticated;

create or replace function moderator_reinstate_user(p_user_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set account_status = 'active', updated_at = now() where id = p_user_id;
  insert into moderation_actions (actor_id, target_type, target_id, action, reason)
    values (auth.uid(), 'user', p_user_id, 'reinstate_user', p_reason);
end;
$$;
revoke all on function moderator_reinstate_user(uuid, text) from public, authenticated;
