-- Found while auditing test coverage for a launch-readiness pass: every
-- moderator_* RPC in this schema (moderator_remove_content,
-- moderator_resolve_report, moderator_warn_user, moderator_suspend_user,
-- moderator_reinstate_user) does `revoke all on function ... from public,
-- authenticated` to lock it down from end users, but NONE of them ever
-- grant execute back to service_role — the actual role
-- MODERATION_RUNBOOK.md instructs a moderator to call these with ("call
-- it only via the service role key").
--
-- In plain PostgreSQL, CREATE FUNCTION grants EXECUTE to the PUBLIC
-- pseudo-role by default, and every role (service_role included) is
-- implicitly a member of PUBLIC. `revoke all ... from public` removes
-- that implicit path for every role at once — it is not scoped to just
-- the `authenticated`/`public` names also listed on the same line. Since
-- none of these five functions had an independent, role-specific grant
-- to service_role the way check_rate_limit() and claim_next_montage_job()
-- correctly do, revoking from public left NO role able to call them
-- at all except the migration-applying superuser.
--
-- Proven against a real Postgres 16 instance, not just reasoned about:
-- `set role service_role; select moderator_warn_user(...);` returns
-- `ERROR: permission denied for function moderator_warn_user` before
-- this fix (repeated for all five). This is exactly why the existing
-- moderator_*.test.sql files never caught it — they deliberately
-- simulate "how a service-role caller with no impersonated user sees
-- auth.uid()" by running as the plain `postgres` superuser (whose
-- BYPASSRLS-equivalent superuser status also bypasses every GRANT
-- check), which exercises each function's internal logic correctly but
-- never actually exercises whether the real `service_role` role can
-- invoke the function at all. See moderator_rpc_service_role_grants.test.sql
-- for the regression test that actually does, using `set role
-- service_role` the way a real PostgREST RPC call would run.
--
-- Net effect before this fix: every step of the moderation runbook
-- (warn, remove content, suspend, reinstate, resolve report) — the
-- private beta's *only* moderation mechanism, since there is
-- deliberately no admin dashboard yet — was uncallable exactly as
-- documented.
grant execute on function moderator_remove_content(text, uuid, text) to service_role;
grant execute on function moderator_resolve_report(uuid, text, text) to service_role;
grant execute on function moderator_warn_user(uuid, text) to service_role;
grant execute on function moderator_suspend_user(uuid, text) to service_role;
grant execute on function moderator_reinstate_user(uuid, text) to service_role;
