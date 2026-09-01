-- docs/MODERATION_RUNBOOK.md's triage process references "moderator_dismiss
-- (see below)" for a no-violation report — no such function was ever
-- built, and no "see below" section exists for it either; report
-- resolution was documented as a raw `update reports set status = ...`
-- statement with no matching moderation_actions log entry at all,
-- unlike every other moderation action in this schema. This is the
-- same class of bug moderator_remove_content() fixed for content
-- removal: a documented moderator capability that either didn't exist
-- or didn't actually do what the runbook claimed.
--
-- moderator_resolve_report() closes both a report's status and its
-- audit trail atomically, one call, service-role-only (matching
-- moderator_suspend_user/moderator_remove_content's exact precedent).
create or replace function moderator_resolve_report(p_report_id uuid, p_status text, p_resolution_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_action text;
begin
  if p_status = 'dismissed' then
    v_action := 'dismiss_report';
  elsif p_status = 'actioned' then
    v_action := 'resolve_report';
  else
    raise exception 'unsupported_status';
  end if;

  update reports set
    status = p_status,
    resolved_by = auth.uid(),
    resolution_notes = p_resolution_notes,
    resolved_at = now()
  where id = p_report_id;
  if not found then raise exception 'not_found'; end if;

  insert into moderation_actions (actor_id, target_type, target_id, action, reason)
    values (auth.uid(), 'report', p_report_id, v_action, p_resolution_notes);
end;
$$;
revoke all on function moderator_resolve_report(uuid, text, text) from public, authenticated;
