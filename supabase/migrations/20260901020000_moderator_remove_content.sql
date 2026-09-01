-- docs/MODERATION_RUNBOOK.md has documented, since the moderation system
-- was first built, that there is "no equivalent moderator RPC" for
-- removing a clip or montage the way moderate_delete_comment() already
-- exists for comments — a moderator was expected to hand-write the
-- UPDATE statements directly against production via the service role.
-- This closes that gap the same way moderator_suspend_user() closed the
-- equivalent one for accounts: one audited RPC, service-role-only.
--
-- Scope matches the runbook exactly: this flips the DB state that
-- controls future visibility (clips.moderation_status = 'removed'
-- already excludes a clip from worker/src/render/fetchEligibleClips.ts's
-- eligible-clip query for any future render; montages.status = 'failed'
-- matches how a failed render is already represented everywhere else in
-- this schema) and logs the action. Deleting the underlying storage
-- object stays a separate manual step, same as the runbook already
-- describes — that's a Storage API call, not a SQL statement, and doing
-- it here would silently couple this RPC to a network call that could
-- partially fail.
create or replace function moderator_remove_content(p_target_type text, p_target_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_target_type = 'clip' then
    update clips set moderation_status = 'removed', deleted_at = now() where id = p_target_id;
  elsif p_target_type = 'montage' then
    update montages set status = 'failed', error_code = 'moderator_removed' where id = p_target_id;
  elsif p_target_type = 'comment' then
    update comments set deleted_at = now(), moderation_status = 'removed' where id = p_target_id;
  else
    raise exception 'unsupported_target_type';
  end if;

  insert into moderation_actions (actor_id, target_type, target_id, action, reason)
    values (auth.uid(), p_target_type, p_target_id, 'remove_content', p_reason);
end;
$$;
revoke all on function moderator_remove_content(text, uuid, text) from public, authenticated;
