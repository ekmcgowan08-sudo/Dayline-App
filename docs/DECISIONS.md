# Dayline — Technical & Product Decisions Log

This log records material decisions made autonomously during the build, per the
minimum-touch protocol: when information was missing, the safest reasonable
default was chosen, recorded here, and work continued. Nothing here is a legal
or business commitment — see `docs/OWNER_ACTIONS_REQUIRED.md` for anything that
genuinely needs the owner.

Entries are append-only and dated. Newer entries can supersede older ones —
superseded entries are marked rather than deleted.

---

## 2026-08-31 — Source material

**Initial state:** The git repository as received contained only a 26-byte
`README.md` and a single "Initial commit" — no ZIP, no prior Expo/React
Native code, and no Supabase migrations were present in git history or the
working tree.

**Update (same day, mid-session):** The user then supplied
`Dayline_App_Artifacts.zip` directly (containing `README.md`, `ARCHITECTURE.md`,
`PRODUCT.md`, `ROADMAP.md`, `COSTS.md`, `LAUNCH_CHECKLIST.md`, and a nested
`dayline-app.zip` with an actual Expo SDK 51 + React Navigation vertical
slice and one Supabase migration). This is the "recovered ZIP" the task
description refers to. It was fully audited before any further work. The
Google Drive folder referenced in the task was not fetched (per instructions,
recovered material actually in hand is authoritative and the Drive link must
not be depended on).

**Audit findings — the recovered slice matches the task's own description of
it almost exactly:**
- Expo SDK 51, React 18.2, RN 0.74, `@react-navigation` native-stack, `expo-av`
  (deprecated), `expo-camera` 15, JS-only local notification scheduling.
- Real, working (unverified-but-plausible) code for: email/password auth
  context, session persistence via AsyncStorage, 5-second camera capture,
  clip upload to a private `clips` bucket, a signed-URL clip list, a
  `CaptureSchedule` screen with an 8am–11pm / ~8-reminders/day default, a
  montage viewer that polls `montages.status` and plays via a signed URL,
  group create/join screens, and a full initial Postgres schema
  (`profiles`, `notification_preferences`, `clips`, `daily_sessions`,
  `montages`, `groups`, `group_members`, `reactions`, `comments`, `reports`,
  `blocks`, `analytics_events`, `subscriptions`) with RLS enabled and
  explicit policies on every table.
- `supabase/functions/render-montage/index.ts` is explicitly a stub: it
  inserts a `montages` row with `status='processing'` and a `TODO` — it never
  calls ffmpeg or produces a playable video. This is the exact placeholder
  the task told us to replace with a real pipeline, confirmed firsthand.
- Known weaknesses called out in the recovered docs themselves and confirmed
  by reading the code: invite codes are generated with `Math.random()`
  (not cryptographically strong), group-join has a check-then-insert race on
  the 10-member cap (not atomic/DB-enforced), storage paths are
  `{userId}/{timestamp}.mp4` (guessable, not per the "unguessable paths"
  requirement), there is no admin role / remove-member / delete-group / leave
  flow, no reactions or comments UI, no memories, exports, subscriptions, AI
  features, or automated tests, and RLS policies do not yet enforce blocking
  or group-membership removal against reactions/comments.

**Decision — what was carried forward vs. replaced:**
- **Carried forward as-is:** the positioning line ("Don't perform your life.
  Remember it."), the alternate-tagline and 20-name-candidate lists (folded
  into `PRODUCT.md`), the 8am–11pm/~8-reminders-per-day default schedule, the
  cost-table and roadmap-milestone structure (numbers refreshed against
  current 2026 vendor pricing per the task's instruction), and the
  launch-checklist item list (expanded into the full documentation set).
- **Replaced/upgraded rather than preserved verbatim:** the mobile stack
  (SDK 51→57, `expo-av`→`expo-video`/`expo-audio`, bare React Navigation→
  Expo Router — see the SDK-57 entry below, which already anticipated this
  upgrade path before the ZIP arrived and remains the correct target), the
  screens (rebuilt with the actual design system instead of unstyled
  `<Button>`/`<TextInput>`, but keeping the same screen inventory and
  navigation shape), invite-code generation (moved server-side, using
  `expo-crypto`-grade randomness with collision retry and rate limiting),
  group join (moved to an atomic Postgres function so the 10-member cap can't
  race), storage paths (moved to random UUID paths, not user/timestamp
  derived), and of course the render pipeline itself (real containerized
  ffmpeg worker per Phase 3, replacing the stub).
- The recovered `supabase/migrations/0001_init.sql` is kept verbatim as
  `supabase/migrations/00000000000001_init.sql` (the historical baseline —
  never applied to any live database, since no Supabase project exists yet)
  and everything else is layered on top as new timestamped migrations, per
  the task's "extend through incremental migrations rather than destroying
  existing data" instruction, even though in this case no data actually
  exists yet to lose.

**Consequence:** Dayline is being rebuilt on modern versions with the
recovered slice's product decisions and schema shape preserved as the
starting contract, not thrown away and not blindly kept either.

**Bug found while first running the preserved baseline migration:** the
recovered `0001_init.sql` created `montages` (which references
`groups(id)`) *before* creating `groups` — a forward reference that fails
on any fresh Postgres database with `relation "groups" does not exist"`,
meaning this migration could never actually have been run successfully
against a real empty Supabase project. Fixed by reordering the two `create
table` statements in `00000000000001_init.sql`; no other content changed.
Confirmed by running it against a real local Postgres 16 instance (see
`supabase/tests/run_migrations.sh`) — see verification note in
`docs/IMPLEMENTATION_STATUS.md`.

---

## 2026-08-31 — Core mobile stack

**Decision:** Expo SDK 57 (React Native 0.86, React 19.2, TypeScript 6),
scaffolded with `create-expo-app` default TypeScript template, using
**Expo Router** (file-based routing) as the navigation system instead of
bare `@react-navigation/*` wiring.

**Rationale:**
- SDK 57 is Expo's current `latest` npm dist-tag (57.0.18 at build time);
  SDK 58 exists only as canary. This satisfies "current stable Expo SDK."
- The task says to preserve React Navigation "unless changing navigation
  systems creates a clear, documented benefit that outweighs the migration
  risk" — but there is no existing navigation code to preserve (see prior
  entry), so this rule doesn't constrain a fresh build.
- As of SDK 56+, Expo Router forked its navigator primitives from
  `@react-navigation/*` (apps import from `expo-router/*` now) and is Expo's
  officially recommended, actively maintained routing system, with built-in
  deep linking, typed routes, and protected-route layouts — all of which
  Dayline needs (protected app shell, deep links into montages/groups).
  Hand-rolling `@react-navigation` stacks would be strictly more work for a
  worse outcome on a greenfield app.
- `create-expo-app`'s current default template already ships Expo Router,
  confirming it's the path of least resistance officially endorsed today.

**Package manager:** npm (the scaffold tool generated a `package-lock.json`;
no other lockfile convention existed to preserve).

---

## 2026-08-31 — Media APIs: no `expo-av`

**Decision:** Use `expo-camera` (recording), `expo-video` (playback),
`expo-audio` (any standalone audio needs), and `expo-file-system` for local
file handling. `expo-av` is not used anywhere.

**Rationale:** `expo-av` is deprecated/removed in current Expo SDKs in favor of
the split `expo-video`/`expo-audio` packages, per current Expo docs and the
explicit instruction not to retain `expo-av`.

---

## 2026-08-31 — Backend: Supabase, local-first development

**Decision:** Supabase (Postgres + Auth + Storage + Edge Functions) via the
Supabase CLI for local development (`supabase start`, Docker-based local
stack). All schema changes are timestamped SQL migrations under
`supabase/migrations/`. RLS is enabled on every user-data table with explicit
per-operation policies (see `docs/SECURITY.md`).

Production Supabase project creation is an **owner action** (requires account
ownership/billing) — see `docs/OWNER_ACTIONS_REQUIRED.md`. All work is
designed to run fully against local Supabase without any production
credentials.

---

## 2026-08-31 — Render worker: containerized Node + fluent-ffmpeg

**Decision:** The daily/group montage renderer is a standalone Node.js +
TypeScript worker (`worker/`), packaged as a Docker image, using system
`ffmpeg` (via `fluent-ffmpeg`) rather than a native mobile-side renderer.

**Rationale:** Client-side video composition on-device is slow, inconsistent
across iOS/Android, and hard to make idempotent/retryable. A server-side
worker can be scaled, retried, dead-lettered, and tested with fixture videos
independent of the mobile app, and matches the task's explicit requirement for
"a portable, containerized FFmpeg worker."

**Environment constraint:** This build environment has no running Docker
daemon (`docker info` fails) and no cloud container host credentials. The
worker was developed and its logic validated by running it directly under
Node with a locally-`apt`-installed `ffmpeg` binary (fixture clips in
`worker/test-fixtures/`), and the Dockerfile was written and structurally
reviewed but the image itself could not be built or run in this session. This
is recorded as a verification gap in `docs/IMPLEMENTATION_STATUS.md`, not
claimed as tested.

**Hosting:** Left as a documented, portable choice (any Docker-capable host —
Fly.io, Render, Railway, a VPS, or self-hosted) rather than locked to one
vendor, pending an owner decision informed by current pricing in `COSTS.md`.

---

## 2026-08-31 — Subscriptions: RevenueCat, mock mode by default

**Decision:** RevenueCat (`react-native-purchases`) is the entitlement/IAP
layer, wired behind a `SubscriptionProvider` with a **mock adapter** that is
used whenever no real RevenueCat API key is present in the environment. The
mock adapter never claims a purchase succeeded silently — it exposes an
explicit "Simulate purchase (dev only)" affordance that's visually marked as
non-production.

**Rationale:** RevenueCat is the current de facto standard cross-platform
subscription layer for Expo apps per its own docs, and the task explicitly
allows/expects it. Real store product IDs, App Store Connect / Play Console
subscription setup, and RevenueCat project keys are owner actions.

---

## 2026-08-31 — AI captions/transcription: provider abstraction, local mock only

**Decision:** A `TranscriptionProvider` interface lives behind a Supabase Edge
Function (never called with secrets from the client). The only implementation
shipped in this build is a deterministic local mock adapter (`worker` side)
used for testing the interface and consent flow. Feature is OFF by default
behind a feature flag and requires explicit per-clip user consent before any
audio/video would be sent to an external provider.

**Rationale:** No production AI transcription credentials are available or
requested; the task requires the feature to be fully optional, consent-gated,
and testable without live keys.

---

## 2026-08-31 — Design system naming

**Decision:** "Dayline" is used as a working name throughout, centralized in
a single `mobile/src/constants/brand.ts` file (app display name, wordmark
text, bundle identifiers) so it can be renamed in one place if trademark
clearance requires it. No claim of trademark or App Store name availability
is made — flagged in `docs/OWNER_ACTIONS_REQUIRED.md`.

---

## 2026-08-31 — Age gate default

**Decision:** Default target audience is **13+ private beta**, pending owner/
legal confirmation, per the task's explicit instruction to default to 13+
absent other evidence. Age confirmation is captured at signup and stored as an
acceptance record row, not just a checkbox that's discarded.

---

## 2026-08-31 — Schema hardened and proven against a real Postgres, not just read

**Decision:** Before writing any mobile code against it, the full schema
(recovered baseline + 7 new migrations covering idempotent uploads, capture
slots, montage lifecycle/ordering, group hardening, moderation, blocking,
subscriptions, memories, storage buckets, and account deletion) was run
against a real local PostgreSQL 16 instance (`apt install postgresql`,
since no Docker daemon is available for `supabase start` in this sandbox —
see the render-worker entry above) using a minimal stand-in for Supabase's
`auth`/`storage` schemas and role grants
(`supabase/tests/_supabase_stub.sql`), then exercised with a hand-written
RLS security test suite (`supabase/tests/rls_security.test.sql`) proving
all nine guarantees the spec requires. `supabase/tests/run_all.sh` runs
both steps and exits non-zero on any migration error or failed assertion.
This is real "Auto" tier verification, not "should work."

**Three genuine bugs this caught (none of which a read-through would
reliably find):**
1. **Forward reference in the recovered baseline.** `montages` (which
   references `groups(id)`) was created before `groups`, so the original
   `0001_init.sql` fails on any fresh database. Fixed by reordering.
2. **Infinite RLS recursion.** The baseline's `group_members` SELECT policy
   queried `group_members` from inside its own USING clause — Postgres
   re-evaluates RLS on that inner query too, so any SELECT against the
   table threw "infinite recursion detected in policy." Fixed with a
   SECURITY DEFINER `is_group_member()` helper, which runs with the
   (superuser) function owner's privileges and so doesn't re-trigger RLS.
3. **Rate-limit ledger that could never accumulate.** `join_group_by_code`
   originally logged a failed attempt with `INSERT` and then `RAISE
   EXCEPTION` on invalid codes. Since a RAISE aborts the transaction (and
   PostgREST runs each RPC call in its own transaction in production; the
   test's exception-catching wrapper reproduces the same rollback locally),
   the logging INSERT was undone every single time — the brute-force
   protection could never actually engage. Redesigned to return
   `jsonb {"ok": ..., "error": ...}` for all expected outcomes instead of
   raising, so the ledger write commits as part of a normal successful
   call. `not_authenticated` is the only case still raised (a caller bug,
   not a user-facing branch). **Consequence for the mobile client:** the
   groups service must check `result.ok`/`result.error` on
   `join_group_by_code`, not try/catch — documented in
   `mobile/src/services/groups.ts`.

**Also found and fixed while writing the tests:** the recovered baseline's
`reactions`/`comments` policies used `for all using (<montage access>)`
with no `with check`. Postgres reuses `USING` as the insert/update check
when `WITH CHECK` is omitted, and that USING clause never constrained
`user_id` — so, unpatched, any user who could see a montage could have
inserted a comment/reaction row claiming to be a *different* user. Split
into explicit per-operation policies with `auth.uid() = user_id` on
insert (see `20260831030000_moderation_and_blocks.sql`).

**Known limitation of this verification tier:** the stub `auth`/`storage`
schemas are a hand-built approximation of Supabase's real platform schema
(documented at the top of `_supabase_stub.sql`), not the genuine article —
this sandbox has no Docker daemon to run real `supabase start`. Running
`supabase db reset` against a real local Supabase stack is still owner/
future-session work tracked in `docs/IMPLEMENTATION_STATUS.md`, but the
SQL logic itself, the RLS policies, and the nine required security
guarantees are now proven correct against real Postgres 16 semantics
(recursion, transaction/rollback behavior, RLS policy evaluation, and
default-deny grants all behave identically to production Postgres — only
the platform-specific tables/triggers Supabase adds around `auth.users`
are stubbed).

## 2026-08-31 — Account deletion happens immediately, not after a grace period

**Decision:** `delete-account` deletes storage + the auth user (cascading
through every table) as soon as the user confirms in-app, rather than
scheduling a deferred purge after N days.

**Rationale:** A grace-period purge needs a scheduler (cron Edge Function
or equivalent) that actually runs — this build and this sandbox have none,
and claiming a "30-day grace period" without a job that enforces it would
be exactly the kind of unverified claim the task forbids. Immediate
deletion is the honest thing this repo can actually promise. A
production deployment with real scheduling infrastructure could
reasonably switch to a grace-period model — `account_deletion_requests`
already records `requested_at`/`scheduled_purge_at` in anticipation of
that, it's just not wired to anything that acts on it yet. Documented as
a real gap in `docs/IMPLEMENTATION_STATUS.md`, not silently glossed over.

## 2026-08-31 — Data export: request is real, fulfillment is a manual step

**Decision:** `request_data_export()` writes a genuine, RLS-protected,
auditable row. Nothing in this repo currently compiles or emails the
actual data archive.

**Rationale:** Building a real export pipeline needs either an email-
sending provider (none configured — see
`docs/OWNER_ACTIONS_REQUIRED.md`) or a download-and-decrypt flow, both of
which are more than a beta needs immediately and both need owner
decisions (which provider, what format). Recording the request for real,
rather than faking instant fulfillment or omitting the feature entirely,
was judged the most honest middle ground. `docs/PRIVACY_DATA_FLOW.md`
documents the manual runbook step this implies for now.

## 2026-08-31 — RevenueCat webhook payload could not be verified live

**Decision:** `supabase/functions/revenuecat-webhook/index.ts` is written
against RevenueCat's long-documented webhook shape
(`event.{type, app_user_id, product_id, entitlement_ids,
expiration_at_ms, period_type}`) and shared-secret `Authorization` header,
based on a web search summary — this sandbox's network egress policy
blocked a direct fetch of revenuecat.com's own docs pages to confirm the
exact current field names byte-for-byte. Flagged in the function's own
top-of-file comment as something to re-verify against
https://www.revenuecat.com/docs/integrations/webhooks before relying on
it in production, rather than presenting it as verified.

## 2026-08-31 — app.json had a broken asset reference; fixed while adding real branding/EAS config

**Finding:** `mobile/app.json` (from the `create-expo-app` scaffold) had
`ios.icon: "./assets/expo.icon"`, but that asset directory was deleted
early in this session as part of removing the Expo demo template's
placeholder content (`docs/DECISIONS.md`'s earlier phase). This would
have broken `expo prebuild`/EAS builds the first time anyone tried one.

**Fix:** Rewrote `app.json` with real Dayline branding (name, bundle
identifiers `com.dayline.app`, scheme `dayline`, primary color, camera/
microphone/photo-library permission strings), config plugins for
`expo-camera`/`expo-notifications`/`expo-media-library`/`expo-image-picker`
with their required permission-string config, and an `extra.eas.projectId`
placeholder (real value requires `eas init`, an owner action — see
`docs/OWNER_ACTIONS_REQUIRED.md`). Verified with `npx expo config --type
public`, which resolves every plugin without error — real evidence the
config is valid, not just visually reviewed. Added `mobile/eas.json` with
development/preview/production build profiles.

## 2026-08-31 — Continuation pass: closed three previously-flagged gaps

After the initial 8-phase build, the user asked to keep going. Rather
than invent new scope, this pass closed the three most concrete gaps the
project's own documentation had already flagged as real (not
hypothetical) shortfalls: server-side push delivery, raw-clip storage
lifecycle, and un-enforced entitlement limits. Each is detailed in its
own `docs/IMPLEMENTATION_STATUS.md` phase (9, 10, 11) and
`docs/DECISIONS.md` gets the "why," summarized here:

- **Push delivery reads existing state, never recomputes it.**
  `send-capture-reminders` deliberately queries `capture_slots` (already
  written by the client) instead of reimplementing schedule math
  server-side — a second implementation of the timezone/DST logic in
  `mobile/src/services/schedule.ts` would be a maintenance liability and
  a likely source of subtle drift, for no real benefit.
- **Duplicate suppression is honest about its limits.** Neither iOS nor
  Android gives an app a delivery receipt for a local notification, so
  "prevent duplicate local and server notifications" (a literal product
  requirement) cannot be made airtight — documented as such in both the
  Edge Function and the client dedup module, with a concrete mitigation
  (grace period + client-side `captureSlotId` suppression) rather than
  either skipping the requirement or overclaiming a guarantee that isn't
  achievable.
- **Clip storage lifecycle is two decoupled steps, not one.** Marking a
  clip `used` (fast, synchronous, inside the render job) is separated
  from actually deleting its storage object (a separate scheduled
  function) specifically so a transient storage error can never block an
  otherwise-successful montage render from completing.
- **Entitlement enforcement duplicates a constant across Postgres and TS,
  on purpose, with both sides commented.** The alternative (a shared
  source of truth the client fetches at runtime) is a better long-term
  design but a larger change than this pass's scope — documented as a
  known, deliberate tradeoff rather than either silently duplicating the
  number with no cross-reference or over-engineering a config-fetching
  layer for a single integer.
- **Every new capability shipped with a real, run test**, not just
  review: `notificationDedup.test.ts` (4 tests, mobile), a re-verified
  worker build, and `entitlement_archive.test.sql` (against real
  Postgres, proving both the free-tier restriction and the plus-tier
  unlock). Total automated test count: 16 mobile + 7 worker + 14 SQL = 37.

## 2026-08-31 — Second continuation pass: end card, credits, group timezone, input hardening, Sentry

Asked to keep going again, this pass worked through the specific items
flagged at the end of the previous pass (contributor identification
on-video, per-group timezone, crash reporting) plus two things found
while doing that work rather than invented separately.

- **The "Dayline end card" requirement had never actually been wired to
  entitlement.** `ENTITLEMENT_LIMITS.free.daylineEndCardRequired` existed
  in `mobile/src/constants/entitlements.ts` since Phase 6 but nothing
  read it — the render pipeline had no concept of an end card at all.
  Fixed in `worker/src/entitlements.ts` (a worker-side `getEntitlement()`
  that reads `subscriptions` directly, since the worker runs as the
  service role with no `auth.uid()` and can't call the `current_entitlement()`
  RPC) plus a new `renderTextCard`/`endCardText` option in
  `worker/src/render/pipeline.ts`. Personal montages: gated by the
  owner's own tier. Group montages: **always** get the end card — a
  shared "Our Day" video has no single subscriber whose personal
  entitlement should decide whether branding is removed for everyone
  else in the group too. This is a deliberate simplification, not an
  oversight; a per-member override would need real product input on
  what "the group's plan" even means.
- **Contributor credits are a card, not an overlay.** The product spec
  said "tastefully identify contributors." A burned-in lower-third on
  every clip was considered and rejected: it would sit on top of
  someone's actual 5-second moment for its full duration, which reads as
  more "surveillance camera timestamp" than tasteful. A short
  contributor-credits card appended after the clips (one name per line,
  `worker/src/render/runJob.ts`, capped at `GROUP_LIMITS.maxActiveMembers`)
  achieves the same goal without ever occluding footage. Built from the
  full eligible-clip roster, not just clips that survived download, so a
  transient download failure doesn't silently drop someone from the
  credits.
- **Per-group timezone, and a latent gap closed alongside it.** Adding
  `groups.timezone` (`20260831190000_group_timezone.sql`) meant touching
  the group-mutation RLS/RPC surface for the first time since Phase 4 —
  and turned up that the existing "owner or admin update group" policy
  allowed a raw PostgREST `UPDATE` on the *entire* `groups` row (no
  `WITH CHECK`, no column restriction), meaning an owner/admin could have
  PATCHed `invite_code` or `max_members` directly, bypassing every
  dedicated RPC written to validate those changes. No client code ever
  exercised this (there's no "rename group" feature either), so nothing
  observable changes for the app — but it's exactly the kind of gap that
  should be closed the moment it's noticed, not carried forward. Fixed by
  revoking `UPDATE` on `groups` from `authenticated` entirely and adding
  `set_group_timezone()` as a dedicated, validated RPC alongside the
  existing ones. Timezone validation is real: `now() at time zone
  p_timezone` is Postgres's own IANA database, not a regex approximating
  one.
- **Input validation hardening, found the same way.** Auditing "what
  could an owner/admin still do via a raw API call" for the group work
  prompted the same question for the rest of the schema: `comments.body`,
  `groups.name`, and `profiles.display_name` all had client-side
  `maxLength` props and nothing backing them server-side (unlike
  `reports.reason`, which got a length check in the original hardening
  pass). Added matching `CHECK` constraints
  (`20260831200000_input_validation_hardening.sql`) — limits mirror the
  client's existing values exactly, so no real input this app has ever
  produced is newly rejected.
- **Crash reporting is a real integration, not a placeholder.**
  `@sentry/react-native` is a real dependency with real `init`/
  `captureException`/`setUser` calls in `mobile/src/lib/crashReporting.ts`
  — but every call is gated behind `FEATURE_FLAGS.crashReporting`
  (true only when `EXPO_PUBLIC_SENTRY_DSN` is set), the same no-DSN-means-
  honest-no-op treatment as the RevenueCat mock adapter. Separately, the
  React error boundary wrapping the app (`Sentry.ErrorBoundary`, via
  `CrashReportingErrorBoundary`) catches and shows a real fallback screen
  (`src/components/CrashFallback.tsx`) regardless of whether a DSN is
  configured — that behavior comes from React's error-boundary lifecycle
  itself, not from Sentry being initialized, so the app gets a better
  crash experience than a raw redbox even with reporting fully off.
  `@sentry/react-native/expo` was added to `app.json`'s plugins (verified
  with `npx expo config --type public` — resolves cleanly, only an
  informational warning about missing org/project, which only matters for
  the build-time source-map upload step, not runtime behavior).

Every new piece of behavior got a real, run test: 3 new worker tests
(`pipeline.test.ts`, against real ffmpeg — multi-line text cards, credits
+ end card appended, and the empty-clips case correctly appending
neither), 3 new SQL test files (`group_timezone.test.sql`,
`input_validation.test.sql` — 10 assertions total, run against real
Postgres 16) added to both `supabase/tests/run_all.sh` and
`.github/workflows/ci.yml`, and 5 new mobile tests
(`crashReporting.test.ts`, proving the unconfigured/no-DSN path never
throws). `@sentry/react-native` is mocked in `mobile/jest.setup.js` the
same way AsyncStorage already was — the real SDK leaves native-bridging
timers open that Jest can't tear down, a known characteristic of the RN
SDK in test environments, unrelated to this app's own code.

## 2026-08-31 — CI never actually ran; wired it up and added deploy-by-secret workflows

The user asked to move everything this sandbox genuinely can't build (a
live Supabase project, a Sentry round-trip, the worker's Docker image,
device/simulator testing) to an environment that can, and to build
whatever's actually buildable here first.

**What was actually true, checked directly rather than assumed:** this
sandbox's egress proxy explicitly denies `supabase.com`, `api.supabase.com`,
`sentry.io`, `expo.dev`, and `api.expo.dev` at the gateway (confirmed via
`curl` and the proxy's own status endpoint — `recentRelayFailures` shows
`gateway answered 403` for each, the organization-policy-denial class the
proxy's README says to report rather than route around). Docker itself
was **not** the blocker previously assumed: `dockerd` starts and runs
fine here — the actual failure is that Docker Hub's blob CDN
(`production.cloudfront.docker.com`) is behind the same policy denial, so
an image can be built once the daemon has proxy env vars, right up until
the base-image layer pull. This corrects `docs/OWNER_ACTIONS_REQUIRED.md`'s
prior "no Docker daemon" framing (item 15/"Docker-capable environment")
to the more precise "Docker works, registry pulls are policy-blocked
here" — a real distinction, since it's exactly what a different sandbox
policy or a non-sandboxed environment would fix, whereas "no daemon"
implied it never could.

**GitHub itself was reachable the whole time** (`api.github.com` returns
200; only `github.com` bare and the Docker/Supabase/Sentry/Expo hosts are
denied). More importantly, this repo's `.github/workflows/ci.yml` had
`total_count: 0` runs ever — not because CI was broken, but because its
trigger was `push: branches: [main]` and every phase of this build has
happened on `claude/dayline-mobile-app-mizzky`, which was never merged.
The Docker build job, the real-Postgres RLS suite, the Deno typecheck —
all of it has been sitting there correct and unrun since the first
8-phase pass. Fixed by widening the trigger to include `claude/**` and
adding `workflow_dispatch`, and by opening a PR to `main` (see the PR
this commit is attached to) specifically to fire the `pull_request:`
trigger and get a first real run.

**Three new `workflow_dispatch` workflows turn GitHub Actions into the
"space that can build it all"** for the pieces that need real credentials
this sandbox can't hold anyway — the point isn't that GitHub Actions is a
generically better environment, it's that account creation (Supabase,
Expo, Sentry — identity + billing) is unavoidably a human step no matter
which computer runs the commands, so the only leverage available is
collapsing everything *after* that step into one click:

- `deploy-supabase.yml` — links the project, runs every migration,
  deploys all 7 functions, sets their secrets from one pasted `.env`
  blob (`SUPABASE_FUNCTIONS_ENV`), rather than the user typing ~10 CLI
  commands from `docs/DEPLOYMENT.md` by hand.
- `eas-build.yml` — builds on Expo's own cloud infrastructure, so
  *neither* the GitHub runner *nor* the user's own machine needs Xcode,
  Android Studio, or Docker. Added a new `simulator` build profile to
  `mobile/eas.json` (`ios.simulator: true`) specifically so the default
  run needs **no Apple Developer Program enrollment** — that $99/yr is
  still required for a real-device/App-Store build, but not to get
  something runnable today.
- `verify-sentry.yml` — posts a real event straight to Sentry's classic
  ingest API (`POST /api/<project>/store/` with the DSN's public key in
  `X-Sentry-Auth`) and fails the job unless Sentry actually returns 200.
  This is a genuine round-trip confirmation via the same protocol the SDK
  itself uses, not a check that the request merely didn't error — tested
  locally against a fake DSN (correctly fails with the exact
  policy-denial error this workflow exists to escape) and against
  malformed/empty DSN inputs (correct validation errors) before being
  trusted to run for real in Actions.

All four workflow YAML files were syntax-validated
(`python3 -c "import yaml; yaml.safe_load(...)"`), and the Python
embedded in `verify-sentry.yml` was extracted and run standalone against
three inputs (a well-formed fake DSN, a malformed string, an empty
value) to prove its parsing/error-handling logic before pushing it as
something that will run unattended in CI.

## 2026-08-31 — Automated data-export fulfillment, no email needed

The user said to continue. The last remaining item explicitly flagged as
a real (not hypothetical) gap in `docs/OWNER_ACTIONS_REQUIRED.md`'s "not
required but worth knowing about" section was data-export fulfillment —
`request_data_export()` recorded a genuine request since Phase 5, but
actually compiling and delivering the data was a manual operator step,
because this build has no email-sending infrastructure and building one
felt premature for a beta.

**Decision: skip email entirely rather than add an email provider just
for this.** The user already trusts the app enough to be signed into it;
a signed-URL download inside Settings → Privacy & data needs no new
third-party dependency, no new secret, and no deliverability concerns
(email a JSON attachment somewhere it might get filtered as spam). This
mirrors `get-montage-url`'s existing pattern exactly: an Edge Function
checks ownership server-side, mints a short-lived signed URL, the client
downloads and shares it via `expo-file-system`/`expo-sharing` (already
used for montage save/share, so no new mobile dependency either).

**Split into two functions on purpose**, matching the codebase's existing
split between `purge-used-clips` (cron-invoked, does work) and
`get-montage-url` (JWT-invoked, hands out access): `fulfill-data-export`
runs on a schedule and does the actual compiling/uploading;
`get-export-url` is what the client calls, and never touches anything
but a single already-fulfilled row it's confirmed belongs to the caller.
Neither function needed inventing a new pattern.

**Metadata-only, deliberately** — the export includes clip *timestamps*
and montage *history*, not raw video (no `storage_path` fields at all).
This matches what `docs/PRIVACY_DATA_FLOW.md` already promised before
this function existed, and it's arguably more useful anyway: the clips
and montages stay playable in the app for as long as the account exists,
so a video-heavy JSON export wouldn't add access, just duplicate it.

**`request_data_export()` now dedupes.** The original version inserted a
new row on every call with no guard — harmless until an automated
fulfillment pipeline exists to actually process the backlog a
double-tapped button could create. Fixed alongside adding the pipeline,
not as an afterthought.

Verified: `supabase/tests/data_export.test.sql` (3 assertions: dedup,
a new request allowed once the prior one clears, cross-user RLS) run
against real Postgres 16 — `run_all.sh` now reports 26 total SQL PASS
assertions. Both new Edge Functions could not be `deno check`'d locally
(this sandbox's egress policy blocks `esm.sh`, the CDN both this and
every pre-existing function import `@supabase/supabase-js` from — not a
new limitation, just one this pass happened to hit directly rather than
inheriting silently) — reviewed carefully by hand against the working
`get-montage-url`/`purge-used-clips` functions' exact patterns, and left
for the real `edge-functions-typecheck` CI job (proven working in the
prior pass) to confirm.

## 2026-08-31 — "Your Day Is Ready" push, sent from the worker itself

Asked to keep building and pick the next roadmap item. Chose
Milestone 3's "push notification for 'Your Day Is Ready' specifically" —
the reveal was pull-based only (open the app and see it), a real,
concrete, well-scoped gap the roadmap itself had already named.

**Sent from the render worker directly, not a separate polling
function.** `send-capture-reminders` and `purge-used-clips` both exist
because nothing else knows to act at the right moment — capture
reminders need to fire on a schedule independent of any single request,
and purging needs to happen periodically regardless of render activity.
This is different: the render worker *is* the thing that knows the exact
instant a montage becomes ready, since it's the one flipping the status
row. A separate function polling for `status = 'ready'` rows would just
add latency for no benefit, so `worker/src/pushNotifications.ts` sends
the push inline, right after `runJob.ts` finalizes the montage row —
same non-fatal-by-design treatment as the existing "mark clips used"
step next to it (a push failure must never affect the montage the user
already sees as ready).

**Group montages deliberately excluded.** The requester already watches
their "Our Day" render (they just tapped the button); deciding who else
in the group should be notified — everyone? only people who didn't
contribute? — is a real product question with no obviously-correct
default, not a technical one. Left for Milestone 3's list rather than
guessing.

**A tap on the push should go somewhere.** Nothing in this codebase
handled notification taps at all before this — `expo-notifications` was
only ever used for scheduling and display. Added
`mobile/src/lib/notificationRouting.ts` (which notification shapes
deep-link where) and a listener registered once in `_layout.tsx`. Split
the routing logic into its own dependency-free module for the same
reason `notificationDedup.ts` was: `services/notifications.ts`
transitively imports `lib/supabase.ts`, which throws at import time
without env vars, so anything worth unit-testing has to live somewhere
that doesn't drag that chain in.

**Its own opt-out, not folded into an existing toggle.** Neither the
capture-reminder quiet-hours settings nor `memory_notifications` are the
right fit — quiet hours exist to avoid prompting someone to *go film
something* at an inconvenient time, which doesn't apply to "your
already-recorded video is ready to watch." Added
`montage_ready_notifications` (default `true`) mirroring
`memory_notifications`'s exact existing pattern rather than inventing a
new one, and extended the same settings screen (renamed from
`MemoryNotificationSettings` to `NotificationSettings` since it's no
longer just about memories).

Verified: worker typecheck/build/`node --test` (12 tests, up from 10 —
`buildMontageReadyMessages` pulled out as a pure, testable function
exactly like the render-pipeline helpers already are), mobile
typecheck/lint/`jest` (26 tests, up from 21 —
`getMontageIdFromNotificationData` covered for the well-formed case, the
capture-reminder case that should NOT deep-link, and three malformed-input
cases), and a fresh `run_all.sh` confirming the new migration
(`20260831220000_montage_ready_notifications.sql`) applies cleanly
without needing a dedicated RLS test — it adds a column to a table
(`notification_preferences`) whose existing `for all using (auth.uid() =
user_id)` policy already covers it, the same reasoning
`memory_notifications` relied on before it.

## 2026-08-31 — Deciding the deferred group-push question, then the Memories calendar

Asked to keep building with full decision-making authority. Two items:
finishing what Phase 21 explicitly left open, then the next concrete,
still-unclaimed roadmap item.

**"Who gets notified" for a group montage: everyone except the
requester.** Phase 21 named the options (everyone? only
non-contributors?) without picking one. Reasoning for the pick: a group
montage is fundamentally a *shared* thing — the requester already knows
it's ready because they're the one who tapped "Create Our Day" and
watched it render, so notifying them too is noise, not information.
"Only non-contributors" was considered and rejected: a contributor who
added a clip that morning still doesn't know the *finished, assembled*
video exists until they're told, same as anyone else in the group —
contributing doesn't imply awareness of completion.

**Reused the existing opt-out rather than adding a group-specific one.**
From a recipient's point of view "a Dayline montage of mine is ready" is
one notification type whether it's their personal day or their group's —
introducing a second preference column/toggle for what users would
experience as the same kind of interruption seemed like complexity
without a real corresponding user need. Can be split later if real usage
shows people want them independently.

**Memories calendar: a toggle, not a replacement.** The original
chronological list + search already works and some people will prefer
scanning a list over parsing a calendar grid, especially with few
memories — replacing it outright would be a regression for that case.
Built as a `List`/`Calendar` view-mode toggle instead, sharing the same
underlying filtered data and the same tap-to-open montage behavior.

**No thumbnails, dots instead — a deliberate, not accidental, scope
cut.** A month grid with an actual video frame per day is the more
impressive version of this feature, but it needs the render worker to
extract a poster frame (an `ffmpeg -vframes 1` pass on the finished
montage) and a new storage path/signed-URL flow to serve it — real scope
on top of "richer... beyond the current list," not a natural extension
of it. Colored dots (coral = personal, sky = group, matching the app's
existing two-accent palette) get the actual ask — browse by date,
see at a glance which days have something — without inventing that
infrastructure. Left in `docs/ROADMAP.md` as real, named future work
rather than silently dropped.

Verified: worker 14/14 tests (was 12 — 2 new: group message shape, and
that both push variants share one deep-link tag so the mobile side needed
no changes), mobile 37/37 tests (was 26 — 11 new for `calendarGrid.ts`'s
pure month-grid math, covering every month-length edge case including
leap-year February and both `shiftMonth` year-rollover directions).

## 2026-08-31 — Poster-frame thumbnails, cheaper than the plan I wrote for them

Asked to keep making decisions and building. Went back to the scope cut
`docs/ROADMAP.md` had just been given in the previous pass — "needs the
render worker to extract and store a frame, a larger change than this
pass's scope" — and, before starting on that build-out, checked whether
the assumption behind it still held.

**It didn't: the mobile app already solves this problem, just for a
different asset.** `components/ClipThumbnail.tsx` (existing since early
in this build) generates a thumbnail for a raw clip entirely on-device —
`expo-video-thumbnails` decodes a frame locally from a signed URL, no
server-side frame extraction, no separate image storage, no extra
migration. A rendered montage is playable through the exact same
signed-URL mechanism (`getMontagePlaybackUrl()`/`get-montage-url`) a raw
clip is. There was no reason the same technique wouldn't work identically
for montages — and it does. `MontageThumbnail.tsx` is `ClipThumbnail.tsx`
with one different data source, not a new subsystem.

This is worth recording precisely because the original plan wasn't
wrong given what was known at the time (Phase 23 really didn't have
budget for a worker/storage build-out) — it's that revisiting an
assumption before executing it turned out to make the "larger change"
unnecessary entirely. Worth the extra look before committing to the
bigger version of a feature.

**One deliberate approximation: a fixed 2.2-second sample offset**,
not a duration-probed one. Every montage opens with a title card whose
duration is a known constant (`pipeline.ts`'s default 1.8s), so sampling
just past it reliably lands on real footage without needing to read the
video's actual length first — which would mean a second network
round-trip / decode pass for a purely cosmetic gain. Documented as a
constant with the reasoning attached, not a magic number.

**No dedicated test, on purpose** — `ClipThumbnail`, which this
component mirrors line-for-line in structure, has never had one either.
Both are thin IO/rendering glue over already-tested pieces (the signed-URL
fetch, the thumbnails library); the honest thing is to match the existing
precedent, not add asymmetric test coverage between two components that
do the same job for two different asset types.

Verified: typecheck/lint/`jest` all clean, 37/37 mobile tests still
passing — this phase touched no logic with its own tests, only UI wiring
reusing already-verified pieces.

## 2026-08-31 — Group admin promotion, and the ownership-transfer dead end it uncovered

Asked to keep making decisions and building. Went to close Milestone 4's
last item, "admin-role UI refinements (currently owner/admin have
identical permissions... schema already distinguishes them for future
differentiation)" — and, on inspection, found the premise slightly off:
there was no function anywhere that could ever GRANT admin. The schema
distinguished the roles; nothing could assign one.

**Owner-only, not owner-or-admin.** Every other group-management RPC in
this codebase (`regenerate_invite_code`, `revoke_invite_code`,
`remove_group_member`, `set_group_timezone`) treats owner and admin as
equally privileged. Role management itself is the one deliberate
exception: if admins could promote other members to admin, the two tiers
would converge on identical power within a few taps and the distinction
this phase exists to build would immediately erode. Keeping it
owner-gated is what makes "admin" mean something.

**The outgoing owner becomes `admin`, not `member`.** Found this decision
while building the *second* function of the phase, `transfer_group_
ownership` — added because implementing promotion surfaced a genuine
dead end: `leave_group()` has refused an owner who isn't a group's last
member since Phase 4, with an error name
(`owner_must_transfer_or_delete`) that names a capability that never
actually existed. An owner of a group with other people in it had
exactly one way out: delete the whole group for everyone, including
people who never asked for that. Once transfer exists, demoting the
outgoing owner to `member` felt like a needless second loss — they
presumably still care enough about the group to have kept it running; a
soft landing at `admin` respects that without leaving two owners.

**Scope note:** this went a bit beyond the roadmap line's literal
wording ("UI refinements") because the UI had nothing real to refine
until the backend capability existed, and the ownership-transfer gap was
directly adjacent — found by building the neighboring function, not by
going looking for more scope. Both are now genuinely done, not
partially.

Verified: `supabase/tests/group_role_management.test.sql`, 12 assertions
against real Postgres 16 covering both functions and their interaction
(a former owner's `leave_group()` call only succeeds *after* transferring
ownership away — proving the fix actually closes the gap, not just that
the new function runs). `run_all.sh`: 36 total SQL PASS assertions.
Mobile: typecheck/lint/37 `jest` tests all clean — this phase is RPC glue
and UI wiring, no new pure logic needing its own test, consistent with
how every other `groups.ts` function has been treated.

## Phase 26 — comment/reaction rate limiting

Found while auditing every user-generated-content insert path against the
existing `check_rate_limit()` bucket list (reports, montage requests,
account deletion, transcription, group-join attempts): comments and
reactions were the only two left with zero request-frequency limit —
only length/uniqueness constraints. Both are inserted via a direct
`.insert()` from the mobile client through an RLS `INSERT` policy, not
through an RPC wrapper, so the trigger-vs-RPC-conversion question this
raised was resolved by neither: `report_hardening.sql` had already
established that an RLS `WITH CHECK` clause can call any SQL-callable
function, so `check_rate_limit('comment-post', ...)` /
`check_rate_limit('reaction-post', ...)` were added straight into the
existing `WITH CHECK` expressions on `comments` and `reactions`. No
trigger, no client-code change, no new RPC — the smallest change that
closes the actual gap.

Limits: comments 20 per 5 minutes, reactions 30 per 5 minutes, both per
user. Reactions got the higher number because a single legitimate action
(catching up on a group's feed) can mean reacting to many different
montages in quick succession, while sustained comment-writing at 20/5min
is already well past normal use. Both are tunable constants like every
other bucket in this schema, not claimed to be the final right number.
Deletes (un-reacting) stay unrestricted, matching every other delete
policy in this schema — only creation is rate-limited.

Verified: `supabase/tests/comment_reaction_rate_limit.test.sql`, 4
assertions against real Postgres 16 — 20 real comment inserts succeed
then a 21st is rejected with the RLS `insufficient_privilege` condition
(the same failure mode S5 in `rls_security.test.sql` already proved for
the report bucket), and the same for 30/31 on reactions. `run_all.sh`: 40
total SQL PASS assertions. No mobile/worker code changed — this is a
pure RLS-policy migration — so only `npm run typecheck && npm run lint`
were re-run there to confirm no regression, not the full test suite.

## Phase 27 — group creation rate limiting

Found immediately after closing the comment/reaction gap: `create_group()`
was the last group-membership write path with no rate limit at all. It's
a `raise exception`-style RPC (unlike `join_group_by_code`'s jsonb
`{ok, error}` return), so the check is a plain `if not
check_rate_limit(...) then raise exception 'rate_limited'; end if;` —
placed before the invite-code insert loop, alongside the function's
existing `not_authenticated`/`group_name_required` validation, so a
rejection can't roll back a real insert (nothing has been written yet at
that point).

Limit: 5 groups per hour per user — generous for legitimate use (most
people create at most a handful of groups ever) while blocking
unbounded group creation, which is real abuse surface: each group gets
its own invite code, membership row, and membership-event log entry.
`createGroup()` in `mobile/src/services/groups.ts` maps the raw
`rate_limited` exception text to a friendly message, matching the
mapping pattern already used for `join_group_by_code`'s and
`set_group_member_role`'s jsonb error codes — the one other raw-raised
code (`group_name_required`) is left as-is since the create button is
already disabled client-side when the name is empty, so it can't
actually be reached through the UI.

Verified: `supabase/tests/group_creation_rate_limit.test.sql`, 2
assertions against real Postgres 16 — 5 real group creations succeed
then a 6th is rejected with the exact `rate_limited` message. `run_all.sh`:
42 total SQL PASS assertions (was 40). Mobile: typecheck/lint/37 `jest`
tests all clean — no dedicated mobile test, matching every other
RPC-wrapper function's existing precedent (`setGroupTimezone`,
`setGroupMemberRole`, etc. have none either).

## Phase 28 — moderator_remove_content() RPC (fixes a real bug, not just a documented gap)

`docs/MODERATION_RUNBOOK.md` had documented, since the moderation system
was first built, that there was "no equivalent moderator RPC" for
removing a clip or montage — a moderator was expected to hand-write raw
`UPDATE` statements against production via the service role. Closing
that was the plan; auditing the runbook's *existing* comment-removal
guidance while doing it surfaced something worse: the runbook claimed a
moderator could call the in-app `moderate_delete_comment(comment_id)`
RPC "via service role, which bypasses the ownership check entirely."
That was never true. The function checks `auth.uid()` against the
montage owner or a group owner/admin; a service-role caller with no
impersonated user has `auth.uid()` = null, which matches no one — the
call would always fail with `not_authorized`. The documented moderator
workflow for comments was broken from the day it was written, and
nothing had ever actually exercised it end-to-end to notice.

`moderator_remove_content(target_type, target_id, reason)` fixes both:
one service-role-only RPC (`revoke all ... from public, authenticated`,
matching `moderator_suspend_user`'s exact precedent) covering `'clip'`,
`'montage'`, and `'comment'`, with no ownership check at all — service
role is the authorization, same as every other moderator-only function
in this schema. It flips `clips.moderation_status`/
`comments.moderation_status` to `'removed'` or `montages.status` to
`'failed'` (`error_code = 'moderator_removed'`), and logs one
`moderation_actions` row. Deleting the actual storage object stays a
separate manual step, exactly as the runbook already described — it's a
Storage API call, not a SQL statement, and folding it into this RPC
would couple a DB transaction to a network call that could partially
fail.

Scope note: removing a clip only affects *future* renders (
`fetchEligibleClips.ts` already filters on `moderation_status = 'ok'`
for both personal and group montage eligibility) — it does not
retroactively edit a montage a removed clip already rendered into.
Documented in the runbook rather than silently assumed.

Verified: `supabase/tests/moderator_remove_content.test.sql`, 6
assertions against real Postgres 16 — each target type flips the right
column and logs an audit row, an unsupported target type is rejected,
and critically the comment-removal case is proven with no
`request.jwt.claim.sub` set at all (`auth.uid()` null), which is exactly
what would have silently failed under the old guidance. A final
assertion proves the `authenticated` role still can't call it at all.
`run_all.sh`: 48 total SQL PASS assertions (was 42). No mobile/worker
changes — this is an operator-only capability with zero client
exposure, matching `moderator_suspend_user`/`moderator_reinstate_user`'s
own precedent of having no mobile UI.

## Phase 29 — moderator_resolve_report() RPC

Found immediately after Phase 28, auditing the rest of
`docs/MODERATION_RUNBOOK.md` for the same class of bug: the triage
process's "No violation" bullet referenced `moderator_dismiss` (see
below), but no such function existed anywhere in the schema and no "see
below" section ever described one either — a broken forward reference
that had presumably never been exercised. Report resolution itself
(step 4) was documented as a raw `UPDATE reports SET status = ...`
statement, with no matching `moderation_actions` audit entry unless a
moderator remembered to insert one by hand — the only moderation action
in this whole system without an atomic RPC tying the state change to
its own audit log.

`moderator_resolve_report(report_id, status, resolution_notes)` closes
both: one service-role-only RPC (matching `moderator_suspend_user`/
`moderator_remove_content`'s exact precedent) that updates
`status`/`resolved_by`/`resolution_notes`/`resolved_at` and logs the
matching `moderation_actions` row (`dismiss_report` for `'dismissed'`,
`resolve_report` for `'actioned'`) in the same call. Any other status
value raises `unsupported_status`; a nonexistent report id raises
`not_found`.

Verified: `supabase/tests/moderator_resolve_report.test.sql`, 6
assertions against real Postgres 16 — actioned and dismissed resolutions
both flip the right fields and log the matching audit row, an
unsupported status and a nonexistent report are both rejected, and the
`authenticated` role still can't call it. `run_all.sh`: 54 total SQL
PASS assertions (was 48). No mobile/worker changes — same operator-only
scope as `moderator_remove_content`/`moderator_suspend_user`.
`docs/MODERATION_RUNBOOK.md` updated: the triage process's step 4 now
points at this RPC instead of raw SQL, and the broken `moderator_dismiss`
reference is gone.

## Phase 30 — clear captions on consent revoke

`docs/PRIVACY_DATA_FLOW.md` had documented this as a known, accepted gap
since AI captions were first built: "disabling consent doesn't
retroactively delete existing captions in this build — deleting the
clip does... a known, documented gap for a future 'delete all my
captions' affordance." Revisited it because it's a real privacy
expectation, not a cosmetic one — a user who revokes consent for their
audio being sent to a transcription provider reasonably expects the
transcripts that resulted from that consent to go away too, not just
that future transcription stops.

`transcription_consents` is directly client-writable (`mobile/src/
services/account.ts#updateTranscriptionConsent` does a plain
`.upsert()`, no RPC wrapper), so a trigger — not a new RPC the client
would need to be changed to call — is the fix that works regardless of
how consent gets toggled. `clear_captions_on_consent_revoke()` fires
`AFTER INSERT OR UPDATE ... WHEN (new.consented = false)` and clears
`caption`/sets `caption_status = 'disabled'` for that user's clips.

Small find along the way: `caption_status`'s CHECK constraint has
included `'disabled'` as a valid value since the column was first added
in Phase 1, unused anywhere in the codebase until now — this is
plainly what it was originally meant for. Using it here (rather than
resetting to `'none'`) lets a future UI distinguish "never captioned"
from "was captioned, cleared because consent was revoked," which is a
meaningfully different state to show someone.

Verified: `supabase/tests/clear_captions_on_consent_revoke.test.sql`, 3
assertions against real Postgres 16 — granting consent leaves an
existing caption untouched, revoking it clears the caption and marks it
`'disabled'`, and revoking one user's consent doesn't touch another
user's captions. `run_all.sh`: 57 total SQL PASS assertions (was 54).
No mobile/worker changes — the trigger fires regardless of client code,
and no UI currently renders `caption`/`caption_status` at all (a
separate, pre-existing gap, out of scope here).

(Further entries appended as work proceeds through later phases.)
