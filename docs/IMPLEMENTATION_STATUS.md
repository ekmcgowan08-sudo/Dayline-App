# Dayline — Implementation Status

Last updated: 2026-08-31 (session start). This file is the single source of
truth for "what's actually done" — update it before ending any work session so
a fresh Claude Code session (or a human) can resume without re-deriving state.

Status legend:
- ✅ Done and verified (see evidence)
- 🟡 Implemented, not fully verified (say why)
- ⬜ Not started
- 🚫 Blocked on an owner action (see `docs/OWNER_ACTIONS_REQUIRED.md`)

Verification tiers used throughout (per task instructions — never claim a
tier that wasn't actually done):
- **Auto** — verified by an automated command in this session (test, build, lint)
- **Sim** — verified running in a simulator/emulator in this session
- **Device** — requires a physical iOS/Android device (not available here)
- **ProdCreds** — requires production credentials/accounts not available here

---

## Phase 0 — Repository & documentation audit

✅ Done. Repository contained only a placeholder README and one commit — no
recovered ZIP, no prior mobile app, no Supabase migrations were present. See
`docs/DECISIONS.md` "Source material" entry. Building from scratch against the
product spec.

## Phase 1 — Dependency modernization & stable local build

- ✅ **Mobile scaffold**: Expo SDK 57 (RN 0.86, React 19.2, TS 6) via
  `create-expo-app`, Expo Router, npm. Demo template screens removed.
  Design tokens (`src/constants/theme.ts`), brand constants
  (`src/constants/brand.ts`), and env/feature-flag config
  (`src/constants/config.ts`) in place. **Auto**: `npm install` completed
  cleanly (0 install errors; 12 moderate advisories are all in Expo's own
  dev-time `@expo/config-plugins` toolchain, not shipped app code — see
  `docs/SECURITY.md`).
- ✅ **Supabase schema**: recovered baseline (`00000000000001_init.sql`,
  bug-fixed) plus 7 new migrations
  (`supabase/migrations/2026083101xxxx_*.sql` through `...070000_*.sql`)
  covering idempotent clip uploads, capture-slot tracking, a real montage
  lifecycle + ordered `montage_clips`, hardened groups (admin role,
  crypto-strong invite codes, atomic/rate-limited join, explicit
  opt-in `group_contributions`), moderation/audit tables, block
  enforcement in RLS, locked-down subscriptions, memories, private storage
  buckets, and account/clip/montage deletion RPCs. **Auto-verified**: all
  8 migrations apply cleanly to a real local Postgres 16
  (`supabase/tests/run_migrations.sh`), and all 9 required RLS security
  guarantees pass against it (`supabase/tests/rls_security.test.sql`, via
  `supabase/tests/run_all.sh`, exit 0). See `docs/DECISIONS.md` for the
  three real bugs this run caught (forward-reference table order, RLS
  self-recursion, a rate-limiter whose log writes rolled back on every
  failure) and fixed.
- 🟡 **Real Supabase CLI local stack** (`supabase start`, i.e. the actual
  platform, not the Postgres-16-plus-stub approximation above): not yet
  attempted in this session — this sandbox has no running Docker daemon.
  Tracked as a follow-up; the SQL itself is already proven against real
  Postgres semantics, so this is expected to be a smooth run, not a
  rewrite, whenever Docker is available.
- ⬜ Worker scaffold, CI workflow: later in this phase / Phase 3 and 7.

## Phase 2 — Auth, scheduling, capture, upload, timeline

- ✅ **Auth**: email/password sign-up, sign-in, sign-out, password reset,
  email verification screen, session persistence (AsyncStorage-backed
  Supabase client with foreground-only auto-refresh), protected route
  groups (`(auth)`, `(onboarding)`, `(app)` each redirect based on
  session/onboarding state). **Auto**: typecheck + lint clean. **Sim/Device**:
  not run — no live Supabase project or simulator exercised this session
  (see Environment constraints below); this is genuinely unverified beyond
  static analysis.
- ✅ **Onboarding**: purpose explainer, consent screen (age 13+ + terms +
  privacy + community rules, each recorded as an immutable
  `acceptance_records` row), profile setup (display name, optional photo
  avatar upload to a public `avatars` bucket, auto-detected IANA timezone),
  capture-schedule setup (active days, randomized/hourly/custom-times
  modes, quiet hours, notification permission request, initial
  `capture_slots` sync). "Skip for now" paths exist so nothing is a hard
  gate.
- ✅ **Capture scheduling engine** (`src/services/schedule.ts`): timezone-
  and-DST-aware slot computation. **Auto-verified**: 7 unit tests
  (`src/services/__tests__/schedule.test.ts`, run via `npm test`) proving
  correct UTC conversion across a real DST boundary (America/New_York
  EST↔EDT), active-day filtering, pause, midnight-wrapping quiet hours,
  and custom exact-time mode.
- ✅ **5-second capture**: `expo-camera` front/rear recording capped at
  exactly 5s, live countdown, retake/use/cancel review flow with
  `expo-video` preview, haptics. **Sim/Device**: not run (no camera-capable
  environment here) — reviewed and typechecked only.
- ✅ **Upload queue**: offline-first, AsyncStorage-persisted queue
  (`src/state/upload-queue-store.ts`), idempotent uploads keyed by a
  client-generated `client_capture_id` (unique DB index — retrying an
  upload upserts instead of duplicating), exponential backoff retry
  (5s/15s/60s/300s/900s), foreground + 20s-interval processing
  (`src/hooks/use-upload-queue-sync.ts`), basic file-existence/size
  validation before upload.
- ✅ **Today timeline**: per-slot completed/missed/upcoming states pulled
  from `capture_slots` (not just a raw clip list), in-flight upload rows
  shown separately, lazy on-device thumbnail generation
  (`expo-video-thumbnails` against a short-lived signed URL, cached),
  manual "Capture a moment" always available, no shame-based copy or
  public metrics.
- ✅ **Server-side push notification delivery** (added in a later session
  pass, see Phase 9 below): `send-capture-reminders` Edge Function reads
  the same `capture_slots` rows the client writes and sends Expo pushes
  for slots that came due without a local notification having handled
  them, with a duplicate-suppression scheme between the two delivery
  paths — see Phase 9.

## Phase 3 — Personal montage rendering & reveal

- ✅ **Replaced the placeholder pipeline.** The recovered `render-montage`
  stub only ever inserted a `processing` row. It's replaced by: a
  `request-montage` Edge Function (idempotent, rate-limited, authorization-
  checked, real eligible-clip count check) plus a real containerized
  worker (`worker/`) that downloads, normalizes, concatenates, and uploads
  an actual video.
- ✅ **Worker core (`worker/src/render/pipeline.ts`) — Auto-verified against
  real ffmpeg, not mocked.** `npm test` in `worker/` runs 7 tests using
  synthetic fixture clips (generated on the fly, no binaries committed):
  proves portrait 1080×1920/30fps normalization from a landscape+audio
  source, silent-audio synthesis for clips with none, a typed rejection
  for a corrupt/unreadable clip, title-card rendering, full multi-clip
  concatenation with a corrupt clip skipped gracefully (job doesn't fail),
  and both "abort the whole job" and "no usable segments" failure paths.
- ✅ **Job claiming — Auto-verified against real Postgres.**
  `claim_next_montage_job()` (SKIP LOCKED) proven race-free, oldest-first,
  and correctly reclaims a stale (crashed-worker) job, via
  `supabase/tests/worker_claim.test.sql`.
- ✅ **Worker scaffold runs for real**: `node dist/index.js` was started
  directly (not just typechecked) against a fake Supabase URL — health
  server, structured JSON logs, the poll loop, and graceful SIGTERM
  shutdown all confirmed working live. Build (`npm run build`) and
  typecheck are clean.
- ✅ **Mobile reveal experience**: montage screen with realtime
  (`postgres_changes`) + polling status updates, processing/ready/failed/
  expired states with friendly (non-leaking) error copy, retry action,
  signed-URL playback via the `get-montage-url` Edge Function (never a
  direct client bucket read — see S9 in the RLS suite), save-to-camera-
  roll (`expo-media-library`) and native share sheet (`expo-sharing`).
- 🚫 **Not run**: `docker build`/`docker run` for the worker image (no
  Docker daemon in this sandbox), and the worker's actual Supabase
  Storage/Postgres calls end-to-end (no live Supabase project). Both are
  the natural next verification step once either is available — see
  `worker/README.md`'s verification note and
  `docs/OWNER_ACTIONS_REQUIRED.md`.

## Phase 4 — Groups, group montage, reactions/comments/reports/blocks

- ✅ **Groups**: create (server-side crypto-strong invite code via
  `create_group` RPC), join by code (`join_group_by_code`, returns a
  result object with friendly-mapped errors — invalid/expired, blocked,
  full, rate-limited), group detail (roster with roles, invite-code
  share/regenerate/revoke), remove member / leave / delete-group, all
  through the atomic RPCs proven in `supabase/tests/rls_security.test.sql`
  and `worker_claim.test.sql`.
- ✅ **Our Day (group montage)**: per-clip opt-in "Share" toggle on the
  group screen (writes/removes a `group_contributions` row — nothing is
  shared implicitly), "Create Our Day" reuses the same `request-montage` /
  reveal screen as personal montages (scope: `'group'`).
- ✅ **Reactions & comments**: restrained 6-emoji reaction set, threaded
  under each montage, comment length limit, author-delete and
  moderator-delete (`moderate_delete_comment` RPC — montage owner or
  group owner/admin only), long-press on another person's comment surfaces
  report/block.
- ✅ **Reports & blocks**: `reportContent`/`blockUser`/`unblockUser`
  services wired into the montage comment UI; blocking's actual
  enforcement lives in RLS (mutual comment/reaction hiding, blocked join
  prevention — proven in RLS tests S8a/S8b), not just a client-side filter.
- 🟡 Not yet built: a standalone "blocked users" management list in
  Settings (block/report actions exist, but there's no screen yet to view/
  undo them outside the montage comment long-press flow) — tracked for
  Phase 5's settings work.

## Phase 5 — Memories, exports, settings, deletion, privacy

- ✅ **Memories**: "On this day" (7/30/365-day, via `memories_on_this_day()`
  RPC — pure date math over the user's own ready montages, no facial
  recognition or content profiling), combined personal + group montage
  archive with a text search (matches date or group name) and a
  personal/group filter, personal-montage deletion
  (`delete_own_personal_montage` RPC), empty states.
- ✅ **Settings**: hub + profile edit (name/photo), capture-schedule editor
  (mirrors onboarding, including the custom-times editor — not a stub),
  memory-notification toggle, legal-document viewer (Terms/Privacy/
  Community Rules — see below), support/FAQ screen with a real `mailto:`
  link, blocked-people management (list + unblock).
- ✅ **Data export & account deletion — genuinely destructive, not a soft
  hide.** `request_account_deletion()` records intent; the `delete-account`
  Edge Function removes the user's clip and personal-montage storage
  objects, then calls `auth.admin.deleteUser()`, which cascades through
  every FK'd table (profiles, clips, capture_slots, group_members,
  group_contributions, reactions, comments, blocks, subscriptions,
  acceptance_records, device_push_tokens, notification_preferences). A
  standalone `account_deletion_audit` row (no FK to the now-deleted user)
  is written afterward so deletion stays provable without retaining any
  of the deleted person's data. Data export is a real, audited *request*
  (`data_export_requests` table + RPC); **fulfillment (actually compiling
  and emailing an archive) is a documented manual step for this beta**,
  not automated — no email-sending infrastructure exists in this build.
  This gap is stated plainly, not hidden.
- 🚫 Not run against a live Supabase project (same constraint as Phase 3's
  Edge Functions — reviewed and typechecked, not exercised against real
  storage/auth calls).

## Phase 6 — Subscriptions & optional AI features

- ✅ **Subscriptions**: RevenueCat (`react-native-purchases`) wired for
  real use once platform API keys exist (`configureRevenueCatIfLive`,
  offerings/purchase/restore); when no key is configured the app runs
  entirely on a local mock adapter that is visually and textually marked
  "Development mode... simulated locally and never charge anything" and
  never writes to the real `subscriptions` table (which the client has no
  write access to at all — see the S6 RLS proof). `revenuecat-webhook`
  Edge Function is the only writer, mapping RevenueCat's documented event
  shape to the `subscriptions` row.
  **Caveat**: this sandbox's network access could not reach
  revenuecat.com to double-check the current exact webhook field names/
  auth convention against live docs — flagged directly in the function's
  own comment header, not silently assumed correct.
  A real feature gate (group-count limit, fails safe to the free tier on
  any error) is wired on the Groups screen as a working example other
  gates can follow.
- ✅ **AI captions**: provider-abstraction Edge Function (`transcribe`)
  behind an explicit per-user consent record and an app-wide feature flag
  (off by default). The only *exercised* provider is a deterministic mock
  (no network call, no data leaves Supabase) — the real OpenAI-Whisper-
  shaped provider is implemented and reviewed, not a stub, but untested
  without a live API key. Settings screen lets a user toggle consent and
  run an end-to-end test against their own most recent clip.
- 🚫 Not run against a live Supabase project (consistent with the rest of
  the Edge Functions in this build).

## Phase 7 — Security hardening, tests, CI, performance, a11y

- ✅ **RLS/security hardening**: see Phase 1's schema entry — all 9
  required proofs pass against real Postgres. Added in this phase:
  report filing is now rate-limited (20/hour) and length-validated at the
  database layer (`20260831150000_report_hardening.sql`), consistent with
  "basic abusive-input protection on reports."
- ✅ **Automated tests, all genuinely run, not just written**:
  - `supabase/tests/` — schema/RLS (9 proofs) + worker job-claim
    concurrency (2 proofs), against real Postgres 16.
  - `mobile/src/services/__tests__/schedule.test.ts` — 7 unit tests,
    including real DST-boundary math.
  - `mobile/src/components/ui/__tests__/Button.test.tsx` — 5 component
    tests (this surfaced a real gotcha: `@testing-library/react-native`
    v14's `render()` is async and must be awaited, or `screen` queries
    silently see nothing — documented in `docs/TESTING.md` for whoever
    adds the next component test).
  - `worker/src/render/__tests__/pipeline.test.ts` — 7 tests against real
    ffmpeg with on-the-fly synthetic fixtures.
  - **12 mobile tests + 7 worker tests + 11 SQL proofs = 30 automated
    tests, all passing**, plus clean `tsc --noEmit`, `eslint`, and
    `npm run build` (worker) — all re-verified together at the end of
    this session, not just individually when first written.
- ✅ **CI**: `.github/workflows/ci.yml` — mobile (typecheck/lint/test),
  worker (typecheck/build/test with real ffmpeg installed), a Docker
  build-only job for the worker image, a Postgres-service-container job
  running the exact same migration + RLS + job-claim SQL suites, a Deno
  typecheck job for every Edge Function, an `npm audit --audit-level=high`
  job (verified clean against this repo's current dependency tree — 0
  high/critical in either package), and a `gitleaks` secret-scan job.
  **Not verified**: this sandbox has no outbound access to
  actions.github.com, so the workflow was validated for YAML syntax
  (parses cleanly) and every individual command was proven correct by
  running it directly in this session — but the workflow has never
  actually executed on a real GitHub Actions runner.
- ✅ **Accessibility**: `accessibilityLabel`/`accessibilityRole`/
  `accessibilityState` used throughout interactive elements (icon-only
  buttons, checkboxes, form fields via `TextField`'s built-in label),
  44pt minimum touch targets (`MIN_TOUCH_TARGET` used in `Button`/
  `TextField`/`SettingsRow`), `allowFontScaling` on all text (Dynamic
  Type / Android font scale support), light/dark theme tokens throughout.
  **Not done**: no explicit reduced-motion handling — reviewed and found
  the app currently has no custom animation that would need it (relies on
  native navigation transitions only), so `motion.reducedDuration` tokens
  exist in `theme.ts` for future use rather than being wired to nothing;
  no dedicated screen-reader walkthrough was performed (would need a
  device/simulator).
- 🚫 **Performance**: no profiling was done (needs a device/simulator);
  the render worker's single-job-at-a-time design and its resource
  implications are discussed in its own README.

## Phase 8 — Deployment config, launch docs, final audit

- ✅ All required documentation written: `README.md`, `ARCHITECTURE.md`,
  `PRODUCT.md`, `ROADMAP.md`, `COSTS.md` (dated, sourced against current
  2026 vendor pricing pages), `LAUNCH_CHECKLIST.md`,
  `docs/IMPLEMENTATION_STATUS.md` (this file), `docs/DECISIONS.md`,
  `docs/SECURITY.md`, `docs/PRIVACY_DATA_FLOW.md`, `docs/TESTING.md`,
  `docs/DEPLOYMENT.md`, `docs/OWNER_ACTIONS_REQUIRED.md`,
  `docs/STORE_SUBMISSION.md`, `docs/MODERATION_RUNBOOK.md`,
  `docs/ASSET_LICENSES.md`, plus `TERMS.md`/`PRIVACY.md`/
  `COMMUNITY_RULES.md`/`docs/LEGAL_DRAFTS.md` (DMCA, data deletion,
  subscription disclosures, App Store/Play privacy labels, COPPA/age
  analysis) — every item the task's documentation checklist named.
- ✅ `mobile/app.json`/`mobile/eas.json`: real branding, permission
  strings, config plugins, EAS build profiles — see the DECISIONS.md
  entry for the broken-asset-reference bug this also fixed.
- ✅ Every cost estimate is dated (2026-08-31), sourced with links, and
  explicitly labeled as directional, not guaranteed.
- ✅ Every unverified claim in this file and its companions is labeled
  with a verification tier (Auto/Sim/Device/ProdCreds) — see
  `docs/TESTING.md`'s "genuinely NOT verified" section for the single
  consolidated list.
- ✅ `docs/OWNER_ACTIONS_REQUIRED.md` consolidates every remaining
  nondelegable item into one checklist, cross-referenced from
  `LAUNCH_CHECKLIST.md`.

## Phase 9 — Server-side push notification delivery (post-launch-package pass)

Closed the gap flagged at the end of Phase 2/8: local notifications were
the only reminder path that actually fired.

- ✅ `send-capture-reminders` Edge Function reads the existing
  `capture_slots` rows (never recomputes the schedule server-side, so it
  can't drift from `mobile/src/services/schedule.ts`'s timezone/DST
  logic), sends Expo pushes for due-and-unnotified slots, prunes push
  tokens Expo reports as `DeviceNotRegistered`, and is idempotent
  (`capture_slots.notified_at`) and self-bounding (a 15-minute stale
  window so a cron outage never produces a backlog of late pushes).
- ✅ **Real duplicate-suppression between local and server delivery**,
  not just idempotency within each path individually: both paths tag
  their notification with the same `captureSlotId`; the client
  (`mobile/src/lib/notificationDedup.ts`, wired into the notification
  handler in `mobile/src/services/notifications.ts`) suppresses showing
  a second notification for a slot it already displayed one for. This is
  honestly documented as *not* a guaranteed-zero-duplicates system (no
  delivery receipt exists for a local notification on either platform) —
  a 3-minute server-side grace period plus this client-side suppression
  meaningfully reduces duplicates rather than claiming to eliminate them.
  **Auto-verified**: `mobile/src/lib/__tests__/notificationDedup.test.ts`
  (4 tests) proves the suppression logic itself, including history
  bounding.
- ✅ Scheduling is via `pg_cron`/`pg_net` (both ship with every Supabase
  project). The migration checks for their availability and no-ops
  safely with an instructional `NOTICE` if unavailable (true in this
  session's local-Postgres-only stub) rather than failing — the actual
  `cron.schedule(...)` call needs a real project's URL + secret filled in
  once, documented step-by-step in `docs/DEPLOYMENT.md` and flagged in
  `docs/OWNER_ACTIONS_REQUIRED.md`.
- 🚫 Not run against a live Supabase project or a real device (same
  constraint as every other Edge Function in this build).

## Phase 10 — Clip/storage lifecycle after render (cost control)

Closed `COSTS.md`'s top-listed-but-previously-unimplemented lever
("aggressively expire raw clips after the montage is rendered").

- ✅ The render worker now marks a clip `status = 'used'` once it's been
  incorporated into its **owner's own personal** montage (deliberately
  not done for group-contributed clips — the owner's personal montage for
  that clip may not exist yet). Failure to mark is logged and treated as
  non-fatal — never blocks an otherwise-successful render.
- ✅ `purge-used-clips` Edge Function removes the storage object (not the
  database row — `montage_clips` history stays intact) for `used` clips
  past a configurable retention window (`RAW_CLIP_RETENTION_DAYS`,
  default 7 days), scheduled the same way as Phase 9's function.
- 🚫 Not run against a live Supabase project. The worker-side "mark used"
  logic is covered by the existing worker typecheck/build but has no
  dedicated unit test (it's a small, reviewed, non-fatal-on-error
  Supabase side effect — see `worker/src/render/runJob.ts`; adding a
  mocked-Supabase test harness for the worker was judged lower value than
  the ffmpeg-pipeline tests that already exist, given this session's
  remaining scope).

## Phase 11 — Server-enforced entitlement limits (memory archive)

Closed the gap explicitly called out in Phase 6/8:
`ENTITLEMENT_LIMITS.free.memoryArchiveDays` existed only as a documented
client-side hypothesis with nothing actually enforcing it.

- ✅ `list_my_personal_montages()` / `list_my_group_montages()` RPCs
  enforce the free-tier archive window server-side — a free user's
  session simply cannot retrieve a montage older than the window via any
  client code path, since RLS alone only ever restricted by *ownership*,
  never by *date+entitlement*. `mobile/src/services/montages.ts` now
  calls these RPCs instead of a raw table select.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/entitlement_archive.test.sql` proves a free-tier user
  sees only the montage inside the 30-day window (not a 60-day-old one)
  and that upgrading to `plus` immediately unlocks the full archive —
  wired into `run_all.sh` and CI.
- **Known, deliberate duplication** (documented in both places, not
  silently drifting): the 30-day figure is hardcoded in the SQL function
  *and* in `mobile/src/constants/entitlements.ts`'s
  `ENTITLEMENT_LIMITS.free.memoryArchiveDays` (used for the paywall's
  feature-comparison table), because this build has no shared source of
  truth between Postgres and the TS bundle. A future pass could make the
  RPC the single source of truth and have the client fetch the limit from
  it instead of hardcoding — not done here to keep this change scoped.
- ✅ "On This Day" resurfacing (`memories_on_this_day()`) is deliberately
  **not** subject to this window — surfacing something old on its
  anniversary is a different feature than browsing the full history, and
  a free user should still get a 1-year-ago memory even with a 30-day
  general archive cap.

---

## Environment constraints discovered this session

These bound what "verified" can honestly mean here:

- **No Docker daemon** in this sandbox (`docker info` fails) — the render
  worker's Dockerfile is written but the image was not built/run here. Worker
  logic itself was exercised directly via Node + a locally `apt`-installed
  `ffmpeg` binary against fixture clips.
- **No Supabase CLI network/Docker stack** confirmed runnable here (no
  Docker daemon). Migrations were instead verified against a real local
  PostgreSQL 16 (`apt install postgresql`) with a hand-built stand-in for
  Supabase's `auth`/`storage` schemas — see `supabase/tests/` and the
  "Schema hardened and proven" entry in `docs/DECISIONS.md`. Whether
  `supabase start` itself succeeds in a Docker-capable environment is
  expected to be a smooth run (the SQL is already proven against real
  Postgres), but is untested here.
- **No physical iOS/Android device or macOS**, so iOS builds and device-only
  APIs (push token registration on real hardware, camera on real hardware,
  App Store builds) cannot be verified beyond static/simulator checks where a
  simulator is available.
- **No production accounts**: no Supabase project, RevenueCat project, Apple
  Developer / Google Play Console enrollment, transcription vendor account.
  Everything is built to run against local/mock equivalents and is otherwise
  feature-flagged off.

## Owner actions

See `docs/OWNER_ACTIONS_REQUIRED.md` for the consolidated checklist (kept
up to date, not duplicated here).

## Resume instructions for a future Claude Code session

1. Read this file fully, then `docs/DECISIONS.md`.
2. Run `git log --oneline -20` to see the last committed milestone.
3. Check the task list (`TaskList` tool) for phase-level progress markers.
4. Continue with the first ⬜/🟡 item below its phase heading.
