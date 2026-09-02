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
  reclamation after a simulated worker crash).
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
- **Component tests**: `mobile/src/components/ui/__tests__/Button.test.tsx`
  — press handling, disabled/loading states, accessibility state,
  rendered output, using `@testing-library/react-native` v14 (note: its
  `render()` is `async` — every test must `await render(...)` or
  `screen` queries silently see no rendered tree; this tripped up the
  first draft of this suite and is worth knowing before adding more).
- Run: `npm test` (or `npm run test:watch` while iterating).
- **Not yet covered by automated tests** (reviewed/typechecked only):
  screen-level integration tests for the full onboarding → capture →
  upload → montage flow, and anything requiring a camera, a real Supabase
  project, or a simulator — see the gaps list below.

## Render worker tests

`worker/src/render/__tests__/pipeline.test.ts` runs against **real
ffmpeg** (not mocked) using synthetic fixture clips generated on the fly
by `worker/src/test-fixtures/generate.ts` — no binary video files are
committed to the repo. It proves, by actually invoking ffmpeg and
`ffprobe`-inspecting the output:
- Portrait 1080×1920/30fps normalization from a landscape+audio source.
- Silent-audio synthesis for a clip that has none.
- A typed `ClipRenderError` for a corrupt/unreadable file.
- Title-card rendering with the correct duration.
- Multi-line text-card rendering (used for the contributor-credits card).
- Full multi-clip concatenation with a corrupt clip skipped gracefully
  (the job still succeeds).
- The contributor-credits card and branded end card are actually
  appended (measurable duration increase) when requested, and correctly
  omitted when every clip fails to render (title-card-only output).
- Both the "abort the whole job" and "no usable segments" failure paths.

It does **not** exercise the Supabase download/upload/job-claim code
paths (`worker/src/render/downloadClip.ts`, `fetchEligibleClips.ts`,
`runJob.ts`'s Supabase calls, `poller.ts`) — those need a real Supabase
project. The worker binary itself (health server, structured logging,
poll loop, SIGTERM shutdown) was run directly (`node dist/index.js`)
against a fake Supabase URL in this session and confirmed working
end-to-end short of the actual database/storage calls — see
`worker/README.md`.

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
