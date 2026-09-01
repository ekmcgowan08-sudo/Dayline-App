# Moderation Runbook

This describes the operating process for handling reports and enforcing
the Community Rules during the private beta, before a dedicated admin
dashboard exists. The data model already supports one (`reports`,
`moderation_actions`, `profiles.account_status`) — this document is the
process that runs on top of it using direct, service-role database access
in the meantime.

## Data model recap

- `reports`: a user-filed report (`target_type`, `target_id`, `reason`,
  `status`). Client can insert and read their own; only a moderator
  (service role / a future admin tool) changes `status`.
- `moderation_actions`: append-only audit log of every moderation action
  taken (`warn`, `remove_content`, `suspend_user`, `reinstate_user`,
  `dismiss_report`, `resolve_report`), with `actor_id` and `reason`. No
  client access at all.
- `profiles.account_status`: `active` | `suspended` | `pending_deletion`.
- `blocks`: user-initiated, enforced in RLS (see `docs/SECURITY.md`) —
  most day-to-day "I don't want to see this person" cases resolve here
  without moderator involvement at all.

## Triage process

1. **Check for new reports.** Until an admin dashboard exists, query
   directly (with the service role key, from a secure environment — never
   from a developer's personal machine against production without a
   documented reason):
   ```sql
   select * from reports where status = 'open' order by created_at asc;
   ```
2. **Review the target.** Look up the reported clip/montage/comment/user.
   For a clip or montage, a moderator can read its storage object directly
   via the service role (the same access the render worker has) — this is
   a deliberately narrow, logged capability, not something to do casually.
3. **Decide an action**, using the Community Rules (`COMMUNITY_RULES.md`)
   as the standard:
   - **No violation** → `moderator_dismiss` (see below), reply if the
     reporter should know why (optional; there's no in-app notification
     wired for this yet).
   - **Minor/first offense** → warn (log a `moderation_actions` row with
     action `warn`; no automated warning delivery exists yet — this is a
     manual outreach step for now).
   - **Content violates the rules** → remove it:
     ```sql
     select moderator_remove_content('clip' | 'montage' | 'comment', '<target-id>', 'reason text here');
     ```
     This RPC (service-role-only) flips `clips.moderation_status`/
     `comments.moderation_status` to `'removed'` or `montages.status` to
     `'failed'` (with `error_code = 'moderator_removed'`) and logs the
     `moderation_actions` row itself — one call, one audit entry,
     regardless of target type. Removing a clip also excludes it from
     any *future* render (`fetchEligibleClips.ts` already filters on
     `moderation_status = 'ok'`); it does not retroactively edit a
     montage a removed clip already rendered into — remove that montage
     too if it needs to come down.

     For a clip or montage, also delete the underlying storage object
     directly via the service role (the same access the render worker
     has) — a separate manual step, since it's a Storage API call, not
     a SQL statement.

     (Superseded guidance, corrected here: this document previously said
     a moderator could call the in-app `moderate_delete_comment(comment_id)`
     RPC "via service role, which bypasses the ownership check entirely."
     That was never actually true — the function checks `auth.uid()`
     against the montage owner/group admin, and a service-role caller
     with no impersonated user has `auth.uid()` = null, so that call
     would always fail with `not_authorized`. `moderator_remove_content`
     is the real fix, not just a convenience wrapper.)
   - **Serious/repeat violation** → suspend the account:
     ```sql
     select moderator_suspend_user('<user-id>', 'reason text here');
     ```
     This RPC is intentionally not exposed to any client role — call it
     only via the service role.
4. **Update the report's status**:
   ```sql
   update reports set status = 'actioned', resolved_by = '<moderator-user-id>',
     resolution_notes = '...', resolved_at = now() where id = '<report-id>';
   ```
   (Or `status = 'dismissed'` for no-violation reports.)
5. **Log the action** in `moderation_actions` for anything beyond a plain
   dismissal — this is the audit trail that makes "what happened and why"
   answerable later.

## Illegal content (CSAM, credible threats, etc.)

Handle these outside normal triage: preserve the report and any relevant
IDs, suspend the account immediately (`moderator_suspend_user`), and
follow current legal reporting obligations for the relevant jurisdiction
(e.g., a NCMEC CyberTipline report in the US) — this is a legal
obligation, not optional moderation judgment, and is explicitly out of
scope for this document to give legal advice on; consult counsel before
finalizing this process for a real launch (see
`docs/OWNER_ACTIONS_REQUIRED.md`).

## Appeals

Not yet built as an in-app flow. For the beta, a suspended user who
contacts support (see `SUPPORT_FAQ` in `docs/STORE_SUBMISSION.md`) can be
reviewed manually and reinstated via:
```sql
select moderator_reinstate_user('<user-id>', 'reason text here');
```

## What's intentionally NOT automated yet

- No automated content scanning (image/video hashing against known-bad
  databases, text classifiers). At beta scale with report-driven
  moderation, this is reasonable; revisit before any public/open
  signup launch.
- No in-app notification to a reporter about the outcome of their report.
- No admin web dashboard — this runbook's SQL-via-service-role approach is
  the intentional stopgap for a private beta's expected report volume.
