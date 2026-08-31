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

(Further entries appended as work proceeds through later phases.)
