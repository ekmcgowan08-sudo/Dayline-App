# Testing

## Verification tiers used throughout this repo's docs

- **Auto** — verified by an automated command in a real session (a test
  suite, a build, a live-run process) — not just read and reasoned about.
- **Sim** — verified running in a simulator/emulator.
- **Device** — requires a physical iOS/Android device; not verifiable in
  a headless environment.
- **ProdCreds** — requires production credentials/accounts (a live
  Supabase project, RevenueCat keys, Apple/Google developer accounts).

Everything in this repo was built and, wherever the tier allows, actually
run — not just written and assumed correct. See
`docs/IMPLEMENTATION_STATUS.md` for the tier on every specific feature.

## Run everything

```bash
# Database schema + RLS security proofs (needs local Postgres 16; see below)
bash supabase/tests/run_all.sh

# Mobile: typecheck, lint, unit + component tests
cd mobile && npm run typecheck && npm run lint && npm test

# Render worker: typecheck, build, tests against real ffmpeg
cd worker && npm run typecheck && npm run build && npm test
```

All three are also wired into `.github/workflows/ci.yml`.

## Database & RLS tests

`supabase/tests/` contains:

- `_supabase_stub.sql` — a minimal stand-in for Supabase's `auth`/
  `storage` platform schema and default role grants, built because this
  development sandbox has no Docker daemon to run the real `supabase
  start` local stack. It is **not** the genuine Supabase platform — see
  its own header comment for exactly what's approximated vs. real. What
  it does NOT approximate: RLS policy evaluation, transaction/rollback
  semantics, `FOR UPDATE SKIP LOCKED` concurrency behavior, and default-
  deny grants all behave identically to production Postgres, because
  they run on real Postgres 16.
- `run_migrations.sh` — applies the stub schema then every migration in
  `supabase/migrations/`, in order, to a fresh throwaway database.
- `rls_security.test.sql` — the 9 required security proofs (see
  `docs/SECURITY.md` for the list). Hand-written (no pgTAP dependency);
  each scenario ends in `RAISE NOTICE 'PASS: ...'` or `RAISE EXCEPTION
  'FAIL: ...'`, so a broken guarantee fails the whole script loudly.
- `worker_claim.test.sql` — proves `claim_next_montage_job()`'s
  concurrency safety (no double-claim, oldest-first, stale-claim
  reclamation after a simulated worker crash) and its retry cap on
  repeated worker-crash reclaims: retry count increments per reclaim,
  a job that exhausts its budget is marked `failed` instead of retried
  forever, and a poison pill doesn't block a real job queued behind it.
- `entitlement_archive.test.sql` — proves `list_my_personal_montages()`
  actually enforces the free-tier 30-day archive window server-side, and
  that upgrading to `plus` immediately lifts it.
- `group_timezone.test.sql` — proves `set_group_timezone()` is
  owner/admin-only, that Postgres itself rejects an unrecognized IANA
  zone name, and that the raw `UPDATE` gap on `groups` closed alongside
  it is actually gone (not just removed from the UI).
- `input_validation.test.sql` — proves the `CHECK` constraints on
  `comments.body`/`groups.name`/`profiles.display_name` actually reject
  over-length or whitespace-only input at the database level.
- `group_role_management.test.sql` — proves owner-only admin promotion/
  demotion and ownership transfer, including that a former owner can
  only `leave_group()` after transferring ownership away.
- `comment_reaction_rate_limit.test.sql` — proves the `check_rate_limit()`
  calls embedded in the `comments`/`reactions` `INSERT` policies actually
  block a 21st comment or 31st reaction within the same 5-minute window.
- `group_creation_rate_limit.test.sql` — proves `create_group()`'s
  `check_rate_limit()` call actually blocks a 6th group creation within
  the same hour.
- `group_membership_entitlement_limit.test.sql` — proves both
  `create_group()` and `join_group_by_code()` enforce the entitlement-based
  active-group cap (2 free / 10 plus) server-side (see
  `docs/IMPLEMENTATION_STATUS.md` Phase 47): a free user is rejected with
  `group_limit_reached` on their 3rd group whether creating or joining,
  a free user under the limit can still join normally, and a plus user
  is unaffected up to 10.
- `moderator_remove_content.test.sql` — proves the moderator-only
  content-removal RPC flips the right column for clip/montage/comment,
  logs an audit row, rejects an invalid target type, works with no
  impersonated user (the real service-role calling convention), and is
  not callable by the `authenticated` role.
- `moderator_resolve_report.test.sql` — proves the moderator-only
  report-resolution RPC flips status/resolution fields and logs the
  matching audit row for both outcomes, rejects an unsupported status
  or a nonexistent report, and is not callable by the `authenticated`
  role.
- `clear_captions_on_consent_revoke.test.sql` — proves the
  `transcription_consents` trigger clears a user's existing captions the
  moment they revoke AI-caption consent, leaves them untouched while
  consent is granted, and never touches another user's captions.
- `moderator_warn_user.test.sql` — proves the moderator-only warn RPC
  logs the expected audit row and is not callable by the `authenticated`
  role.
- `push_token_reassignment.test.sql` — proves `register_push_token()`
  reassigns a shared device's token to a new user, including a
  dedicated assertion that reproduces the original bug (a plain client
  upsert on the same scenario hits an RLS error), plus safe same-user
  re-registration and invalid-platform rejection.
- `rate_limit_race.test.sh` — the one test in this directory that isn't
  a `.sql` file, because it needs real concurrency: two separate
  Postgres backends racing `check_rate_limit()` for the same
  `(bucket, subject)`, which a single-connection `.sql` script can't
  express. Proves the fix in `20260902000000_rate_limit_race_fix.sql`
  for a real TOCTOU bug found by testing against a live Postgres 16
  instance — the original two-statement (read count, then insert)
  function let two concurrent callers both read the count before
  either insert committed, so both could pass even at `max_events=1`,
  exceeding the caller's own stated limit. Since `check_rate_limit()`
  gates real writes directly via RLS `WITH CHECK` (comments, reactions,
  reports, group creation) as well as several Edge Functions
  (transcribe, delete-account, request-montage), this wasn't
  theoretical — a double-tap or two devices signed into the same
  account could trigger it. The test instruments the function's
  *actual deployed definition* (not a hand-written stand-in) with an
  injected delay between its read and its insert to make the race
  deterministic, asserts exactly one of two concurrent callers passes
  at `max_events=1`, then restores the real function unchanged.
- `group_limit_race.test.sh` — same shape and same reason as
  `rate_limit_race.test.sh`, for the same TOCTOU bug class found again in
  `create_group()` and `join_group_by_code()`
  (`20260903040000_group_limit_race_fix.sql`): each read the caller's
  current group count and compared it to their entitlement limit, then
  inserted a new membership row, with no lock between. Proven against a
  real Postgres 16 instance: a free-tier user at 1 of their 2 allowed
  groups who fires two concurrent `join_group_by_code()` calls — or one
  `create_group()` and one `join_group_by_code()` concurrently — ends up
  in 3 groups, not capped at 2. The test instruments both functions'
  *actual deployed definitions* with a delay injected right after each
  acquires its fix's advisory lock (so a genuinely fixed function still
  has to serialize correctly, not just skip the race window), fires both
  the same-function and cross-function races, asserts exactly one caller
  succeeds in each and the user ends up in exactly 2 groups, then
  restores the real functions unchanged.
- `revenuecat_event_race_fix.test.sql` — proves `apply_revenuecat_event()`
  (`20260903050000_revenuecat_event_race_fix.sql`), the third instance of
  this same TOCTOU class found this session, this time in
  `revenuecat-webhook`'s out-of-order-event guard (Phase 32): a first-ever
  event for a user always applies, a strictly older event is rejected and
  leaves the row untouched, a strictly newer event applies, an event at
  the exact same timestamp as the one already applied still applies
  (idempotent redelivery, not silently dropped), and an event with no
  timestamp always applies. Unlike the two `.sh` scripts above, this one
  is a plain single-connection `.sql` file — the fix here collapses the
  race into one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE`
  statement, so there's no separate read-then-write step left to inject
  a delay into; the concurrency guarantee itself was proven with two
  real concurrent `psql` connections during development (both arrival
  orders) and is documented in `docs/IMPLEMENTATION_STATUS.md` Phase 58
  rather than re-proven here.
- `transfer_ownership_race.test.sh` — same shape and same reason as
  `rate_limit_race.test.sh`/`group_limit_race.test.sh`, for a fourth
  instance of this TOCTOU class found in `transfer_group_ownership()`
  (`20260903060000_transfer_ownership_race_fix.sql`): it checked the
  caller currently holds `role = 'owner'`, then updated two rows
  further down, with no lock between — nothing in the schema stops a
  group from ending up with two `owner` rows. Proven against a real
  Postgres 16 instance: an owner with two other members who fires two
  concurrent `transfer_group_ownership()` calls to two different
  targets ends up with **two** owners, not one. The test instruments
  the actual deployed function with a delay injected right after it
  acquires its fix's advisory lock, fires the same two-target race,
  asserts exactly one caller succeeds and the group ends up with
  exactly one owner, then restores the real function unchanged.
- `zero_owner_race.test.sh` — same shape again, this time for a
  *cross-function* variant found while closing out the one above:
  `transfer_group_ownership()`'s own lock only serializes it against
  itself, not against `remove_group_member()`, which never contends for
  that lock at all. Proven against a real Postgres 16 instance: an
  owner transferring ownership to a member while an admin concurrently
  removes that same member can leave the group with the old owner
  correctly demoted to `admin`, the target correctly removed, but
  nobody promoted to `owner` — zero owners, permanently stuck (every
  function that manages roles or deletes the group requires an existing
  owner). The test instruments the deployed `transfer_group_ownership()`
  with a delay between its target-existence check and its actual role
  updates — the exact gap the bug lived in — fires it concurrently with
  `remove_group_member()` targeting the same user, and asserts the
  group ends up with exactly one owner (either function winning is
  correct; only zero is a failure).
- `invite_attempts_race.test.sh` — same shape again, for
  `join_group_by_code()`'s own hand-rolled invite-code brute-force
  guard (`20260903080000_invite_attempts_race_fix.sql`), which predates
  `check_rate_limit()` and has the identical read-then-insert shape
  that function had before Phase 38. Proven against a real Postgres 16
  instance: 25 concurrent `join_group_by_code()` calls with an invalid
  code for the same user all passed the 20-per-10-minutes rate check —
  none were rejected, so an attacker guessing invite codes in parallel
  faces no real limit. The test instruments the deployed function with
  a delay right after it acquires its lock, fires the same 25-caller
  race, and asserts exactly 20 pass with exactly 20 attempt rows
  recorded.
- `orphaned_montage_storage_purge.test.sql` — proves the `BEFORE DELETE`
  trigger on `montages` (`20260902010000_orphaned_montage_storage_purge.sql`)
  queues a deleted row's `storage_path` into `pending_storage_purges`,
  both via a group's cascade delete (the real bug: `delete_group()` never
  touched the `montages` storage bucket) and via a direct row delete (the
  general safety net this was built as), and that a montage with no
  `storage_path` yet is never queued.
- `moderator_rpc_service_role_grants.test.sql` — proves all five
  `moderator_*` RPCs (warn, remove content, suspend, reinstate, resolve
  report) are actually callable by the real `service_role` database
  role — the role `MODERATION_RUNBOOK.md` instructs a moderator to call
  them with — not just by the migration-applying superuser the other
  `moderator_*.test.sql` files simulate a service-role caller with
  (which bypasses grant checks entirely, and so never caught that all
  five were missing the `grant execute ... to service_role` their
  `revoke all ... from public` needed to be paired with).
- `acceptance_records_idempotent.test.sql` — proves the unique
  constraint on `(user_id, document, version)`
  (`20260902030000_acceptance_records_idempotent.sql`) makes a retried
  consent-screen submission (the real scenario: an interrupted
  onboarding flow re-sends the same acceptance rows on next launch) a
  no-op that preserves the original `accepted_at`, while a genuinely new
  document version still records its own row.
- `schedule_prefs_bounds.test.sql` — proves the `CHECK` constraints on
  `notification_preferences` (`wake_hour`, `sleep_hour`,
  `reminders_per_day`, `custom_times` length — see
  `docs/IMPLEMENTATION_STATUS.md` Phase 49) actually reject values a
  direct API call could otherwise send past the client's Stepper/UI
  caps, while legitimate max-of-range values still insert cleanly.
- `group_owner_account_deletion.test.sql` — proves account deletion no
  longer destroys or orphans a group (see
  `docs/IMPLEMENTATION_STATUS.md` Phase 50): a departed founder's
  account deletion (after transferring ownership away and leaving
  entirely) doesn't destroy the group or the real current owner's
  membership, and a sole owner's account deletion auto-promotes the
  earliest-joined remaining member to owner — who is then verified to
  actually exercise owner powers, not just hold the role label.
- `account_suspension_enforcement.test.sql` — proves
  `20260903090000_account_suspension_enforcement.sql`: a user suspended
  via `moderator_suspend_user()` (the RPC `MODERATION_RUNBOOK.md`
  instructs moderators to call for a serious violation or illegal
  content) is blocked from inserting a new clip, posting a comment or
  reaction, and from `create_group()`/`join_group_by_code()`, while
  still able to `SELECT`/`DELETE` a clip they created before being
  suspended. Before this fix, `account_status = 'suspended'` was set by
  that RPC but read nowhere else in the codebase, so none of the above
  were actually blocked — proven against a real Postgres 16 instance:
  a suspended user could still insert clips and create groups with no
  error. Also asserts an unrelated non-suspended user is unaffected by
  any of the new checks.
- `leave_group_race.test.sh` — proves `20260903100000_leave_group_race_
  fix.sql`: a fifth instance of this session's TOCTOU class, this time in
  `leave_group()` — it read a group's member count, then much later (after
  deleting the caller's own membership, logging a membership event, and
  firing the owner-departure trigger) acted on that stale count to decide
  whether to delete the whole group, with nothing stopping a concurrent
  `join_group_by_code()` from adding a brand new member in the gap.
  Proven against a real Postgres 16 instance: a sole owner leaving while
  a second user concurrently joins via the group's invite code let
  `join_group_by_code()` return `{"ok": true, ...}` for a group that
  `leave_group()` then silently deleted out from under it — the joiner
  told they'd joined a group that, moments later, no longer existed. The
  test instruments each function in turn with a delay right after it
  acquires its fix's `'group_ownership:'` advisory lock, to exercise both
  possible arrival orders, and asserts `join_group_by_code()`'s reported
  outcome is never inconsistent with real database state in either one.
- `run_all.sh` — runs all of the above in sequence; exit code reflects
  the first failure, if any.

**Local Postgres setup** (if you don't already have one):
```bash
sudo apt-get install -y postgresql   # or your OS's equivalent
sudo service postgresql start        # or: pg_ctlcluster 16 main start
```
A real `supabase start` (via the Supabase CLI + Docker) is expected to
apply the same migrations cleanly, since they're already proven against
real Postgres — this hasn't been run in this development sandbox (no
Docker daemon here), so treat that specific combination as the one
remaining untested step, not the SQL itself.

## Mobile tests

- **Unit tests**: `mobile/src/services/__tests__/schedule.test.ts` — 7
  tests proving the capture-scheduling engine's timezone/DST math,
  active-day filtering, pause, quiet-hour wraparound, and custom-time
  mode against real `date-fns-tz` conversions (not mocked).
  `mobile/src/lib/__tests__/notificationDedup.test.ts` — 4 tests for
  local/server push-notification duplicate suppression.
  `mobile/src/lib/__tests__/crashReporting.test.ts` — 5 tests proving
  `src/lib/crashReporting.ts`'s exports are safe no-ops with no
  `EXPO_PUBLIC_SENTRY_DSN` set (the state this app ships in until an
  owner configures one). The real `@sentry/react-native` SDK is mocked in
  `mobile/jest.setup.js` — it leaves native-bridging timers open that
  Jest can't cleanly tear down, unrelated to this app's own code.
  `mobile/src/services/__tests__/clips.test.ts` — 2 tests proving the
  offline upload queue's per-user filtering: on a shared/borrowed
  device, another still-signed-out user's queued-but-not-yet-uploaded
  clip is never uploaded (or shown) under a different user's account,
  and correctly resumes once its own owner is signed in again. Mocks
  `../lib/supabase`/`../lib/storageUpload`/`expo-file-system` — pure
  client-side queue logic, no live Supabase project needed.
  `mobile/src/lib/__tests__/passwordResetLink.test.ts` — 5 tests for the
  pure function that parses Supabase's recovery-link URL fragment
  (`#access_token=...&type=recovery`) into tokens: a real link, a link
  with no fragment, a non-recovery `type`, a missing token, and null
  input.
  `mobile/src/services/__tests__/profile.test.ts` — 2 tests proving
  `uploadAvatar()` uploads every profile photo to the same stable
  per-user storage path (so `upsert: true` actually overwrites the
  previous one instead of leaking a new object per change — see
  `docs/IMPLEMENTATION_STATUS.md` Phase 45) while still returning a
  different, cache-busted public URL on every call.
  `mobile/src/services/__tests__/notifications.test.ts` — 3 tests for
  `handleColdStartNotification()`, the cold-start half of the "Your Day
  Is Ready" push deep link (see `docs/IMPLEMENTATION_STATUS.md`
  Phase 51): a launch-from-killed tap on a montage-ready push deep-links
  to the right montage and clears the response; a normal launch (no
  notification response) never navigates; an unrelated notification type
  never navigates either. The same file's `registerPushTokenRefreshListener`
  suite (1 test, added for Phase 52) proves a rotated push token
  captured via `Notifications.addPushTokenListener()` gets forwarded to
  `register_push_token()`. Mocks `expo-notifications`, `expo-router`,
  and `../../lib/supabase`.
- **Component tests**: `mobile/src/components/ui/__tests__/Button.test.tsx`
  — press handling, disabled/loading states, accessibility state,
  rendered output, using `@testing-library/react-native` v14 (note: its
  `render()` is `async` — every test must `await render(...)` or
  `screen` queries silently see no rendered tree; this tripped up the
  first draft of this suite and is worth knowing before adding more).
- **Screen tests**: `mobile/src/app/(app)/montage/__tests__/id.test.tsx` —
  renders the montage reveal screen with Realtime mocked to never deliver
  an update (the one failure mode where the screen's poll fallback is the
  only thing that can move it past "processing") and advances fake timers
  across two 4-second poll ticks, asserting the poll actually re-fetches.
  Written to catch a real regression this session found: the poll's
  `setInterval` closed over stale `null` state and never fired at all — see
  `docs/IMPLEMENTATION_STATUS.md` Phase 43. Mocks every service/native
  module the screen imports (`expo-video`, `expo-router`,
  `expo-media-library`, `expo-sharing`, `expo-file-system/legacy`, and this
  app's own service modules).
  `mobile/src/app/__tests__/reset-password.test.tsx` — 2 tests for the
  password-reset deep-link screen: a valid recovery link results in
  `supabase.auth.setSession()` being called with the exact tokens parsed
  from the URL and the "Set a new password" form rendering (proving the
  screen's deliberate placement as a top-level route, outside `(auth)/`,
  actually avoids `(auth)/_layout.tsx`'s "already signed in? redirect to
  /" check firing the instant the recovery session makes it look signed
  in); an invalid/tokenless link surfaces an "isn't valid" message
  instead of hanging on a permanent spinner. See
  `docs/IMPLEMENTATION_STATUS.md` Phase 44 for the bug this closes — the
  entire "forgot password" flow had no code path to actually complete a
  reset.
- Run: `npm test` (or `npm run test:watch` while iterating).
- **Not yet covered by automated tests** (reviewed/typechecked only): the
  full onboarding → capture → upload → montage flow end-to-end (the
  montage reveal screen's poll fallback above is a targeted regression
  test, not a full integration test of that flow), and anything requiring
  a camera, a real Supabase project, or a simulator — see the gaps list
  below.

## Render worker tests

`worker/src/render/__tests__/pipeline.test.ts` runs against **real
ffmpeg** (not mocked) using synthetic fixture clips generated on the fly
by `worker/src/test-fixtures/generate.ts` — no binary video files are
committed to the repo. It proves, by actually invoking ffmpeg and
`ffprobe`-inspecting the output:
- Portrait 1080×1920/30fps normalization from a landscape+audio source.
- Silent-audio synthesis for a clip that has none.
- A clip longer than `MAX_CLIP_SECONDS` (8) is actually trimmed, not
  rendered in full — both the returned duration and the real
  ffprobe-measured output duration are checked against a genuine
  12-second synthetic fixture (see `docs/IMPLEMENTATION_STATUS.md`
  Phase 48: nothing server-side previously capped a single clip's
  rendered length, only the client-side camera API argument did).
- A typed `ClipRenderError` for a corrupt/unreadable file.
- Title-card rendering with the correct duration.
- Multi-line text-card rendering (used for the contributor-credits card).
- Full multi-clip concatenation with a corrupt clip skipped gracefully
  (the job still succeeds).
- The contributor-credits card and branded end card are actually
  appended (measurable duration increase) when requested, and correctly
  omitted when every clip fails to render (title-card-only output).
- Both the "abort the whole job" and "no usable segments" failure paths.

`worker/src/render/__tests__/ffmpegExec.test.ts` proves a real, deterministic
hang — `ffmpeg -i` pointed at a `mkfifo` named pipe with no writer, which
blocks in a genuine `open()` syscall exactly like a corrupt/pathological
real input could — resolves (rejects with a timeout `FfmpegError`) within
its configured `timeoutMs` instead of hanging forever (see
`docs/IMPLEMENTATION_STATUS.md` Phase 53: `node:child_process.execFile`
has no default timeout, so without this a single hung process blocked
the worker's single-job poll loop forever). Also the reason the fix uses
`killSignal: 'SIGKILL'` rather than `execFile`'s own `SIGTERM` default —
proved empirically first that a real ffmpeg process stuck in this state
does not die on `SIGTERM` (it installs its own handler for a graceful
stop mid-encode that a process still blocked in `open()` never reaches).

`worker/src/__tests__/timeoutFetch.test.ts` proves the same class of
fix for the worker's network side (see `docs/IMPLEMENTATION_STATUS.md`
Phase 54): a plain `node:net` TCP server that accepts a connection but
never writes a response — a real hang, not a mock — makes
`createTimeoutFetch(300)` reject with a `TimeoutError` in ~311ms
instead of hanging forever, closing the same "no default timeout"
gap `supabaseAdmin`'s PostgREST/Storage calls had.

`worker/src/__tests__/pushNotifications.timeout.test.ts` proves the
same fix wired into the worker's third and final hang-prone network
call site (see `docs/IMPLEMENTATION_STATUS.md` Phase 55): the raw
`fetch` to Expo's push API inside `pushNotifications.ts`. Rather than
re-testing `createTimeoutFetch` itself (already covered above), this
mocks `supabaseAdmin.js` so the token/preference lookups resolve
instantly, points `config.expoPushUrl` at the same kind of
never-responding TCP server, and asserts that the exported
`sendMontageReadyPush`/`sendGroupMontageReadyPush` — the functions
`runJob.ts` actually awaits — resolve in ~300ms instead of hanging,
proving the wiring rather than just the underlying mechanism.

`worker/src/render/__tests__/runJob.test.ts` exercises `runJob.ts`'s own
orchestration logic — the first test to do so — with every dependency
(`fetchEligibleClips`, `downloadClipToFile`/`uploadMontageFile`,
`renderMontage`, `getEntitlement`, the push-notification senders,
`supabaseAdmin`) stubbed via Node's built-in `node:test` `mock.module()`
(the `test` script passes `--experimental-test-module-mocks` for this).
It proves the fix for a real bug (see `docs/IMPLEMENTATION_STATUS.md`
Phase 46): when every eligible clip downloads fine but fails to
*normalize*, `runJob` must fail the job rather than upload and finalize
a "successful" montage that's really just a blank title card with
`clip_count: 0`.

Beyond that one orchestration test, this suite still does **not**
exercise the real Supabase download/upload/job-claim code paths against
a live project (`worker/src/render/downloadClip.ts`,
`fetchEligibleClips.ts`, `poller.ts`'s actual RPC call) — those need a
real Supabase project. The worker binary itself (health server,
structured logging, poll loop, SIGTERM shutdown) was run directly
(`node dist/index.js`) against a fake Supabase URL in this session and
confirmed working end-to-end short of the actual database/storage
calls — see `worker/README.md`.

## Edge Function tests

No live Supabase project exists in this development sandbox to invoke
`supabase/functions/*` against. What was done instead:
- Every function was written against the platform's documented contract
  (JWT verification via `admin.auth.getUser()`, service-role-only writes,
  rate limiting via `check_rate_limit()`).
- CI (`edge-functions-typecheck` job) runs `deno check` against every
  function — this catches type errors and bad imports without needing a
  running Supabase instance, though it hasn't been exercised on a real
  GitHub Actions runner in this session (no outbound access to
  actions.github.com from this sandbox).
- Once a real Supabase project exists, `supabase functions serve` plus a
  handful of `curl` calls (see each function's own header comment for its
  request shape) is the fastest way to close this gap — tracked in
  `docs/OWNER_ACTIONS_REQUIRED.md`.
- `delete-account`'s Phase 57 addition (cleaning up the `avatars` and
  `exports` buckets, alongside the pre-existing `clips`/`montages`
  cleanup) is the same "no live Supabase project" gap in a sharper
  form: this sandbox's egress policy also blocks `deno.land` directly,
  so even a local `deno check` couldn't be run before pushing. The new
  code calls the identical `admin.storage.from(bucket).list()`/
  `.remove()` methods the same function's `clips`/`montages` steps
  already use and CI has already type-checked clean, against a table
  and column (`data_export_requests.storage_path`) queried the same
  way `montages.storage_path` already is a few lines above — so this
  leans on that existing, CI-verified pattern rather than exercising
  new API surface, but CI's Deno typecheck job on the actual push is
  still the first real check this specific change gets.

## The primary end-to-end user journey (from the project brief)

The 15-step journey (create User A → schedule → capture/upload clips →
personal montage → create group → User B joins → contributes → group
montage → react/comment → User C denied access → block/removal affects
access → memory resurfacing → export → account deletion) is **implemented
end-to-end in the codebase** (every step has real, working code — see
`docs/IMPLEMENTATION_STATUS.md` phase-by-phase). It has **not** been
run as a live scripted journey against a running app + Supabase project +
worker in this session, because that requires all three simultaneously
running with real accounts, which needs the Docker/Supabase-CLI
capability this sandbox lacks. Steps 1–4 and 9–13's *authorization logic*
specifically (the parts that matter most from a security standpoint) are
covered by the RLS test suite above using synthetic users, which is a
real if partial substitute — but running the actual mobile app through
this flow on a simulator or device remains open work, tracked in
`docs/OWNER_ACTIONS_REQUIRED.md`.

## What's genuinely NOT verified (read this before claiming "done")

- Anything requiring a camera, microphone, or physical/simulated device.
- Any live Supabase project interaction (auth, Postgres via PostgREST,
  Storage, Edge Functions, Realtime).
- RevenueCat's real purchase/restore flow and the `revenuecat-webhook`
  payload shape (written from a web-search summary of RevenueCat's
  documented format, not confirmed against a live account or the docs
  site directly — see `docs/DECISIONS.md`).

Two items previously listed here turned out to be wrong, not just
unverified, once actually checked (see `docs/DECISIONS.md`'s "CI never
actually ran" entry) — corrected rather than left stale:
- **The worker's Docker image build**: real, on real GitHub Actions
  (`ci.yml`'s `worker-docker-build` job), confirmed green on 9
  consecutive runs, not merely syntax-checked.
- **GitHub Actions CI actually running on GitHub's infrastructure**: it
  does — `ci.yml` had simply never been *triggered* (its push trigger
  was scoped to `main`, but every phase of this build happened on a
  feature branch). Now runs on every push; see the run history linked
  from `docs/IMPLEMENTATION_STATUS.md`.
