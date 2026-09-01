-- The last inconsistency in the moderation system: every other action
-- (remove_content, suspend_user, reinstate_user, resolve_report/
-- dismiss_report) is a single service-role-only RPC that writes its
-- state change and its moderation_actions audit row together. A warning
-- is log-only (no state change to make), so it had been left as a raw
-- INSERT the runbook describes by hand — this gives it the same RPC
-- pattern purely for consistency and to keep "how do I log a moderation
-- action" a single answer regardless of which action it is.
create or replace function moderator_warn_user(p_user_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into moderation_actions (actor_id, target_type, target_id, action, reason)
    values (auth.uid(), 'user', p_user_id, 'warn', p_reason);
end;
$$;
revoke all on function moderator_warn_user(uuid, text) from public, authenticated;
