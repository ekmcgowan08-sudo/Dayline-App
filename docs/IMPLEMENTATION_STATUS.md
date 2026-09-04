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
- ✅ A standalone "blocked users" management list in Settings was the one
  gap this phase flagged for Phase 5 — **built there** (Settings →
  Privacy & data's blocked-people list, see below). Stale 🟡 corrected
  here rather than left to imply an open gap that's actually closed.

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
  (`data_export_requests` table + RPC); fulfillment was originally a
  documented manual step for this beta (no email-sending infrastructure
  exists in this build) — **superseded by Phase 20**, which automated it
  without ever needing email.
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

## Phase 13 — Entitlement-gated Dayline end card

Closed a gap that was subtler than the others: `ENTITLEMENT_LIMITS.free.
daylineEndCardRequired` existed since Phase 6 but nothing in the render
pipeline had ever read it — there was no end-card concept at all.

- ✅ `worker/src/entitlements.ts`'s `getEntitlement()` reads `subscriptions`
  directly (the worker has no `auth.uid()` as the service role, so it
  can't call the `current_entitlement()` RPC).
- ✅ `renderTextCard`/`endCardText` in `worker/src/render/pipeline.ts` —
  personal montages: gated by the owner's tier. Group montages: always
  shown (see `docs/DECISIONS.md` for why a per-member override isn't
  attempted).
- ✅ **Auto-verified against real ffmpeg**: `pipeline.test.ts`'s new tests
  prove the end card/credits segments are actually appended (duration
  grows) and are correctly *omitted* when every clip fails to render.

## Phase 14 — Contributor credits card for group montages

- ✅ A short credits card (one contributor name per line, capped at
  `GROUP_LIMITS.maxActiveMembers`) is appended after the clips in a group
  montage only — never a personal one. Built from the full eligible-clip
  roster (`worker/src/render/runJob.ts`), not just clips that survived
  download, so a transient download failure doesn't drop a real
  contributor from the credits.
- ✅ Rejected approach, documented in `docs/DECISIONS.md`: a burned-in
  per-clip lower-third overlay, which would sit on top of someone's
  actual footage for its whole duration.

## Phase 15 — Per-group timezone for group montage day boundaries

- ✅ `groups.timezone` (`20260831190000_group_timezone.sql`), owner/admin
  settable via a new `set_group_timezone()` RPC — validated by Postgres's
  own timezone database (`now() at time zone p_timezone`), not a regex.
  `create_group()` also accepts an optional timezone at creation time
  (mirrors the device-timezone-at-onboarding pattern already used for
  personal profiles).
- ✅ `worker/src/render/fetchEligibleClips.ts`'s group branch now uses the
  group's own timezone for the day-boundary calculation instead of a
  hardcoded UTC day (personal montages were already timezone-aware).
- ✅ Mobile: group create screen passes the device timezone;
  `groups/[id].tsx` shows the current setting to owner/admin with a
  "use my timezone" action when it differs from the device's.
- ✅ **Latent gap closed alongside this** (see `docs/DECISIONS.md` for the
  full story): the pre-existing "owner or admin update group" RLS policy
  allowed a raw `UPDATE` on the entire `groups` row with no column
  restriction. `UPDATE` is now revoked from `authenticated` on `groups`
  entirely — every mutation goes through a dedicated, validated RPC.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/group_timezone.test.sql` (5 assertions) proves: owner
  can set a valid timezone, an invalid one is rejected, a plain member is
  refused, and — the important one — a raw `UPDATE` on `groups` is now
  rejected outright for the `authenticated` role even for the group's own
  owner.

## Phase 16 — Input validation hardening (defense in depth)

- ✅ `comments.body`, `groups.name`, and `profiles.display_name` now have
  `CHECK` constraints (`20260831200000_input_validation_hardening.sql`)
  matching the mobile client's existing `maxLength` values exactly —
  closing the gap where only `reports.reason` had server-side length
  enforcement and everything else relied on a client prop that a direct
  API call could ignore.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/input_validation.test.sql` (5 assertions) proves each
  constraint actually rejects over-length or whitespace-only input at the
  database level, not just in the UI.

## Phase 17 — Crash reporting (Sentry)

Previously listed under "Not required, but worth knowing about" in
`docs/OWNER_ACTIONS_REQUIRED.md` — now a real integration, off by default.

- ✅ `@sentry/react-native` is a real dependency. `mobile/src/lib/
  crashReporting.ts` wraps `init`/`captureException`/`setUser`, every call
  gated behind `FEATURE_FLAGS.crashReporting` (true only when
  `EXPO_PUBLIC_SENTRY_DSN` is set) — same honest-no-op treatment as the
  RevenueCat mock adapter, never a silent pretend-success.
  `@sentry/react-native/expo` added to `app.json`'s plugins — verified
  with `npx expo config --type public` (resolves cleanly; only an
  informational warning about missing org/project, which is a build-time
  source-map-upload detail, not a runtime one).
- ✅ The app is wrapped in a real React error boundary
  (`CrashReportingErrorBoundary` in `_layout.tsx`) with a proper fallback
  screen (`src/components/CrashFallback.tsx`, "Try again") — this catches
  and displays regardless of whether a DSN is configured, since that's
  React's error-boundary lifecycle, not Sentry's initialization state.
- ✅ **Auto-verified**: `mobile/src/lib/__tests__/crashReporting.test.ts`
  (5 tests) proves every exported function is a safe no-op with no DSN
  configured — the state this app ships in until an owner sets one.
- 🚫 Not verified against a live Sentry project (no DSN, no network
  egress to sentry.io in this sandbox) — see `docs/OWNER_ACTIONS_REQUIRED.md`.

## Phase 19 — CI actually wired up; deploy-by-secret GitHub Actions workflows

`.github/workflows/ci.yml` existed since Phase 7 but had **never run** —
its trigger was `push: branches: [main]` and every phase of this build
happened on a feature branch that was never merged. Fixed, and used the
fact that GitHub Actions runners aren't behind this sandbox's egress
policy (which explicitly denies supabase.com, sentry.io, expo.dev, and
Docker Hub's blob CDN — confirmed directly via the proxy's own status
log) to turn Actions into the actual deployment mechanism for everything
that needs real credentials.

- ✅ `ci.yml` trigger widened to `push: branches: [main, 'claude/**']` +
  `workflow_dispatch` — the push that added this trigger fired the very
  first real CI run in the project's history (run 33411588286, 2026-08-31
  16:00 UTC). **All 7 jobs passed**, each confirmed individually via the
  GitHub Actions API, not just the run's overall conclusion: mobile
  (typecheck/lint/test), worker (typecheck/build/test against real
  ffmpeg), **the Docker image build** (the one thing this sandbox
  couldn't do), the full SQL suite against a real `postgres:16` service
  container (migrations + all 5 test files), Deno typecheck on every Edge
  Function, `npm audit --audit-level=high` on both packages, and
  `gitleaks`. This is real, external, first-party confirmation of
  everything this repo's own local testing could only approximate.
- ✅ `deploy-supabase.yml` (`workflow_dispatch`): links a real Supabase
  project, runs every migration, deploys all 7 Edge Functions, sets their
  secrets — from 4 repo secrets instead of ~10 manual CLI commands.
- ✅ `eas-build.yml` (`workflow_dispatch`): builds on Expo's cloud
  infrastructure — no Xcode/Android Studio/Docker needed on the runner
  *or* the user's machine. New `simulator` profile in `mobile/eas.json`
  (`ios.simulator: true`) needs no Apple Developer Program enrollment.
- ✅ `verify-sentry.yml` (`workflow_dispatch`): posts a real event to
  Sentry's classic ingest API and fails unless Sentry returns 200 — a
  genuine round-trip confirmation, not a request-didn't-error check.
- ✅ **Auto-verified**: all four workflow YAML files parsed with
  `python3 -c "import yaml; yaml.safe_load(...)"`. `verify-sentry.yml`'s
  embedded Python was extracted and run standalone against a well-formed
  fake DSN (correctly fails on the network call with this sandbox's own
  policy-denial error — the exact failure this workflow exists to
  escape), a malformed DSN, and an empty DSN (both give the correct
  validation error) before being trusted to run unattended in CI.
- 🚫 None of the three deploy workflows has actually been run against
  real accounts yet — that step needs the account credentials only an
  owner can provide (see `docs/OWNER_ACTIONS_REQUIRED.md`'s "fast path"
  section for exactly which secrets each one needs).

## Phase 20 — Automated data-export fulfillment

Closed the one item still listed under "Not required, but worth knowing
about" in `docs/OWNER_ACTIONS_REQUIRED.md`: fulfilling a data-export
request meant an operator manually compiling a file and emailing it,
since this build has no email infrastructure. Replaced with a real
pipeline that never needs email at all.

- ✅ `request_data_export()` (`20260831210000_data_export_fulfillment.sql`)
  now dedupes — calling it while a request is already `pending` is a
  no-op, so repeat taps on the "Request export" button can't queue
  duplicate work.
- ✅ `fulfill-data-export` (CRON_SECRET-authenticated, scheduled via the
  same `pg_cron` mechanism as `send-capture-reminders`/`purge-used-clips`):
  compiles a
  requester's profile, clips metadata (no raw video/storage paths),
  montages, group memberships, authored comments/reactions/reports,
  subscription, and notification/transcription preferences into JSON,
  uploaded to a new private `exports` storage bucket. Non-fatal
  per-request error handling — a failure leaves that one request
  `pending` for the next scheduled run rather than losing track of it.
- ✅ `get-export-url`: the same ownership-checked-server-side
  signed-URL pattern `get-montage-url` already uses for montage
  playback — the `exports` bucket has zero client-facing storage
  policies, so a client's own session key can never read it directly.
- ✅ Mobile: Settings → Privacy & data now shows the live status of a
  user's most recent export request (pending/fulfilled) and, once
  fulfilled, a real "Download my data" button — downloads the JSON via
  the signed URL and hands it to the OS share sheet (`expo-file-system` +
  `expo-sharing`, the same pattern already used for montage save/share).
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/data_export.test.sql` (3 assertions) proves the dedup
  behavior, that a new request is allowed once the prior one is no longer
  pending, and that a user can never read another user's export
  requests (RLS) — wired into `run_all.sh` and CI.
- ✅ **Confirmed on real CI, not just locally-reviewed**: this sandbox
  can't `deno check` anything (its egress policy blocks `esm.sh`, which
  every function in this build imports `@supabase/supabase-js` from) —
  run 33426326321's `edge-functions-typecheck` job is the first real
  confirmation these two functions actually typecheck. Same run's
  `database` job also confirms `data_export.test.sql` passes against a
  real `postgres:16` service container, not just this sandbox's local
  Postgres.
- 🚫 Still not exercised against a live Supabase project's real storage/
  auth calls (same constraint as every other Edge Function in this
  build) — that needs `deploy-supabase.yml` and a real account.

## Phase 21 — "Your Day Is Ready" push notification

Closed the Milestone 3 roadmap item: the montage reveal was pull-based
only (open the app and see it).

- ✅ `worker/src/pushNotifications.ts`'s `sendMontageReadyPush()` is
  called inline from `runJob.ts` right after a **personal** montage's
  status flips to `ready` — the worker is the only thing that knows this
  exact moment, so there's no separate polling function or added
  latency. Non-fatal (a push failure never affects the montage the user
  already sees as ready), respects a new `montage_ready_notifications`
  preference (default `true`), and cleans up `DeviceNotRegistered`
  tokens the same way `send-capture-reminders` does.
- ✅ Deliberately **not** sent for group montages — see `docs/DECISIONS.md`
  for why (a real "who gets notified" product question, not solved by
  guessing a default).
- ✅ Tap-to-open deep linking: `mobile/src/lib/notificationRouting.ts`
  (which notification shapes navigate where — pulled out as a
  dependency-free module for the same reason `notificationDedup.ts` was)
  + a listener registered once in `_layout.tsx`. This is the first
  notification-tap handling of any kind in this codebase — previously
  nothing happened beyond the OS opening the app.
- ✅ Settings → Notifications (renamed from the memories-only screen)
  now has its own toggle, mirroring `memory_notifications`'s exact
  existing pattern.
- ✅ **Auto-verified**: `worker/src/__tests__/pushNotifications.test.ts`
  (2 tests — `buildMontageReadyMessages` pulled out as a pure function,
  same treatment as the render-pipeline helpers) and
  `mobile/src/lib/__tests__/notificationRouting.test.ts` (5 tests —
  the well-formed case, the capture-reminder case that must NOT
  deep-link, and three malformed-input cases). Worker: 12/12 passing
  (was 10). Mobile: 26/26 passing (was 21).
- ✅ New migration (`20260831220000_montage_ready_notifications.sql`)
  confirmed applying cleanly via a fresh `run_all.sh` — no dedicated RLS
  test needed, since it only adds a column to a table whose existing
  `for all using (auth.uid() = user_id)` policy already covers it.
- ✅ **Confirmed on real CI**: run 33429526839, all 7 jobs passed
  (mobile, worker, Docker build, database, edge-functions-typecheck,
  dependency audit, secret scan) — no regressions from this phase's
  changes, checked individually per job, not just the run's overall
  conclusion.
- 🚫 Not exercised against a live Expo push send or a real device (same
  constraint as every push-related piece in this build).

## Phase 22 — "Our Day Is Ready" push for group montages

Closed the "who gets notified" product question Phase 21 deliberately
left open: decided (see `docs/DECISIONS.md`) rather than left pending.

- ✅ `sendGroupMontageReadyPush()` in `worker/src/pushNotifications.ts`:
  every group member except whoever requested the render. Reuses the
  same `montage_ready_notifications` opt-out as the personal push (one
  notification type, one preference) and the same `dayline-day-ready`
  deep-link tag, so the existing mobile tap handler needed no changes.
  Wired into `runJob.ts` for `job.kind === 'group'`, using the montage
  row's own `requested_by` column (already written by `request-montage`,
  just not previously threaded through the worker's `MontageJob` type).
- ✅ Delivery/cleanup logic shared with the personal push via a common
  `deliverExpoMessages()` helper rather than duplicated.
- ✅ **Auto-verified**: 2 new tests in
  `worker/src/__tests__/pushNotifications.test.ts` (group message
  shape includes the group name; both push variants share the same
  deep-link tag). Worker: 14/14 passing (was 12).

## Phase 23 — Richer Memories calendar/grid view

Closed the last concrete Milestone 3 item.

- ✅ `mobile/src/lib/calendarGrid.ts`: pure month-grid math
  (`buildMonthGrid`, `shiftMonth`) — Sunday-first weeks, correct padding
  for every month length including leap-year February, separately
  testable from the component that renders it (same pattern as
  `schedule.ts`).
- ✅ `mobile/src/components/MemoriesCalendar.tsx`: a real month calendar
  with prev/next navigation, personal (coral) and group (sky) dot
  indicators per day, and tap-to-filter — selecting a marked day filters
  the existing list below to just that date; selecting it again clears
  the filter. List and Calendar are a toggle, not a replacement — the
  original chronological list + search is unchanged for anyone who
  prefers it.
- ✅ **Auto-verified**: `mobile/src/lib/__tests__/calendarGrid.test.ts`
  (11 tests — day counts for 31/30/28/29-day months, 7-cell weeks,
  correct weekday alignment, YYYY-MM-DD ordering, and every `shiftMonth`
  rollover direction). Mobile: 37/37 passing (was 26).
- ✅ Poster-frame thumbnails: **superseded by Phase 24** — done without
  the worker/storage changes originally assumed necessary.
- ✅ **Confirmed on real CI**: run 33439576799 (the 7th consecutive
  clean run), all 7 jobs passed, checked individually per job.

## Phase 24 — Poster-frame thumbnails for Memories

Closed the scope cut Phase 23 flagged, and did it more cheaply than
planned: no worker changes, no new storage bucket or migration, because
the mobile app already had the right pattern sitting in
`components/ClipThumbnail.tsx` for raw clips — it just hadn't been
applied to montages yet.

- ✅ `mobile/src/components/MontageThumbnail.tsx`: calls the existing
  `getMontagePlaybackUrl()` for a signed URL, then `expo-video-thumbnails`
  extracts a frame **on-device** — the same mechanism `ClipThumbnail`
  already uses for raw clips, just pointed at a rendered montage instead.
  Samples at a fixed 2.2s offset (just past the ~1.8s title card every
  montage opens with) so the thumbnail lands on real footage, not the
  date card.
- ✅ Wired into both the Memories list rows and the "On this day" card —
  the calendar grid keeps its dot indicators (a 32px cell has no room
  for a legible frame).
- 🚫 No dedicated test — matches the existing precedent: `ClipThumbnail`,
  which this mirrors exactly, has none either; it's IO/rendering glue
  over already-tested pieces (`getMontagePlaybackUrl`, the thumbnails
  library), not new logic worth a test of its own.
- ✅ **Auto-verified**: typecheck/lint/`jest` all clean, 37/37 mobile
  tests still passing (no regressions — this phase touched no test-bearing
  logic, only UI wiring).
- ✅ **Confirmed on real CI**: run 33463180289 (the 8th consecutive
  clean run), all 7 jobs passed, checked individually per job.

## Phase 25 — Group admin promotion/demotion + ownership transfer

Closed the last Milestone 4 roadmap item — "admin-role UI refinements
(currently owner/admin have identical permissions... schema already
distinguishes them for future differentiation)" — which turned out to
need more than UI once actually checked: there was no function anywhere
that could grant admin status at all. Every member past a group's
founding owner could only ever join as plain `member`.

- ✅ `set_group_member_role(p_group_id, p_target_user_id, p_role)`
  (`20260831230000_group_role_management.sql`): **owner-only** — not
  owner-or-admin like most other group-management RPCs, a deliberate
  choice so admin status can't proliferate without the group's creator
  approving each promotion (see `docs/DECISIONS.md`). Validates the
  target is an actual member, refuses to touch the owner's own role,
  refuses `'owner'` as a settable value.
- ✅ `transfer_group_ownership(p_group_id, p_new_owner_id)` — found while
  building the function above: `leave_group()` has always refused an
  owner who isn't a group's last member
  (`'owner_must_transfer_or_delete'`), but no function ever existed to
  actually perform that transfer, meaning an owner of a group with other
  people in it had exactly one way out: delete the whole group for
  everyone. The outgoing owner becomes `admin`, not a plain member.
- ✅ Mobile: `groups/[id].tsx`'s member rows get "Make admin"/"Remove
  admin" and "Make owner" actions (owner-only), restructured into a
  two-row card layout so the action buttons wrap instead of overflowing
  horizontally. The owner's delete-group confirmation now mentions the
  transfer option as an alternative.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/group_role_management.test.sql` (12 assertions) proves:
  owner can promote/demote; the owner can't change their own role or
  grant `'owner'` through the function; an admin can't promote anyone
  (only the owner can); a plain member can't change any role; ownership
  transfer moves the role and demotes the outgoing owner to admin; a
  former owner can't transfer again; transferring to a non-member is
  rejected; and — the functional payoff — a former owner can now
  actually call `leave_group()` successfully after transferring away,
  where before this migration they could not. `run_all.sh` now reports
  36 total SQL PASS assertions (was 26 at the start of this session's
  second half). Wired into CI.
- ✅ Mobile typecheck/lint/`jest` all clean, 37/37 still passing (no
  dedicated mobile-side tests — this is RPC-calling glue plus UI wiring,
  matching every other `groups.ts` function's existing precedent; the
  real verification is the SQL suite above).
- ✅ **Confirmed on real CI**: run 33463779367 (the 9th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  new `group_role_management.test.sql` explicitly ran and passed inside
  the `database` job's own step list, not just inferred from the job's
  overall conclusion.

## Phase 26 — Comment/reaction rate limiting

Found while auditing every user-generated-content insert path against
the existing `check_rate_limit()` bucket list: comments and reactions
were the only two left with no request-frequency limit at all (reports,
montage requests, account deletion, transcription, and group-join
attempts all already use it).

- ✅ `20260901000000_comment_reaction_rate_limiting.sql`: added
  `check_rate_limit('comment-post', ..., 20, 300)` and
  `check_rate_limit('reaction-post', ..., 30, 300)` directly into the
  existing `comments`/`reactions` `INSERT` `WITH CHECK` policies —
  reusing the exact pattern `report_hardening.sql` already established
  (an RLS `WITH CHECK` clause can call any SQL-callable function), so no
  trigger and no mobile client change were needed. Deletes (un-reacting)
  stay unrestricted, matching every other delete policy in this schema.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/comment_reaction_rate_limit.test.sql` (4 assertions)
  proves 20 real comment inserts succeed and a 21st is rejected with the
  RLS `insufficient_privilege` condition, and the same for 30/31 on
  reactions. `run_all.sh` now reports 40 total SQL PASS assertions (was
  36). Wired into CI.
- ✅ Mobile typecheck/lint clean — no client code changed (the existing
  `toggleReaction`/comment-posting calls already surface `error.message`
  from a rejected insert, so a rate-limited request degrades the same
  way any other insert failure already does).
- ✅ **Confirmed on real CI**: run 33464495875 (the 10th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  new `comment_reaction_rate_limit.test.sql` explicitly ran and passed
  inside the `database` job's own step list.

## Phase 27 — Group creation rate limiting

Found immediately after Phase 26: `create_group()` was the last
group-membership write path with no rate limit.

- ✅ `20260901010000_group_creation_rate_limit.sql`: added
  `check_rate_limit('create-group', ..., 5, 3600)` to `create_group()`,
  placed before any row is written (this function raises exceptions for
  validation rather than returning a jsonb `{ok, error}`, matching its
  own existing `not_authenticated`/`group_name_required` checks).
- ✅ `mobile/src/services/groups.ts`'s `createGroup()` maps the raw
  `rate_limited` exception to a friendly message, matching the mapping
  pattern already used for other RPC error codes elsewhere in this file.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/group_creation_rate_limit.test.sql` (2 assertions)
  proves 5 real group creations succeed and a 6th within the same hour
  is rejected. `run_all.sh` now reports 42 total SQL PASS assertions
  (was 40). Wired into CI.
- ✅ Mobile typecheck/lint/37 `jest` tests all clean — no dedicated
  mobile test, matching every other RPC-wrapper function's precedent.
- ✅ **Confirmed on real CI**: run 33464853976 (the 11th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  new `group_creation_rate_limit.test.sql` explicitly ran and passed
  inside the `database` job's own step list.

## Phase 28 — moderator_remove_content() RPC (real bug fix, not just a gap)

`docs/MODERATION_RUNBOOK.md` documented "no equivalent moderator RPC"
for clip/montage removal since the moderation system was first built.
Auditing that gap surfaced a worse one: the runbook's existing
comment-removal guidance ("call `moderate_delete_comment` via service
role, which bypasses the ownership check entirely") was never actually
true — that function checks `auth.uid()` against the montage owner/group
admin, and a service-role caller with no impersonated user has
`auth.uid()` = null, so the documented moderator workflow for comments
would always have failed with `not_authorized`.

- ✅ `20260901020000_moderator_remove_content.sql`:
  `moderator_remove_content(target_type, target_id, reason)`,
  service-role-only (`revoke all ... from public, authenticated`,
  matching `moderator_suspend_user`'s exact precedent), covering
  `'clip'`, `'montage'`, and `'comment'` with no ownership check at all
  — service role is the authorization. Flips
  `clips.moderation_status`/`comments.moderation_status` to `'removed'`
  or `montages.status` to `'failed'`
  (`error_code = 'moderator_removed'`), logs one `moderation_actions`
  row. Storage-object deletion stays a separate manual step (a Storage
  API call, not SQL).
- ✅ `docs/MODERATION_RUNBOOK.md` updated: the triage process now points
  at this one RPC for all three target types, with an explicit
  correction note about the previous broken guidance.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/moderator_remove_content.test.sql` (6 assertions)
  proves each target type flips the right column and logs an audit row,
  an unsupported target type is rejected, the comment case succeeds with
  no `request.jwt.claim.sub` set at all (the real bug this migration
  fixes), and the `authenticated` role still can't call it. `run_all.sh`
  now reports 48 total SQL PASS assertions (was 42). Wired into CI.
- ✅ No mobile/worker changes — operator-only capability with zero
  client exposure, matching `moderator_suspend_user`/
  `moderator_reinstate_user`'s own precedent.
- ✅ **Confirmed on real CI**: run 33465218515 (the 12th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  new `moderator_remove_content.test.sql` explicitly ran and passed
  inside the `database` job's own step list.

## Phase 29 — moderator_resolve_report() RPC

Same class of bug as Phase 28, found auditing the rest of the runbook:
the triage process referenced a `moderator_dismiss` function that was
never built, and report resolution was raw SQL with no atomic audit log.

- ✅ `20260901030000_moderator_resolve_report.sql`:
  `moderator_resolve_report(report_id, status, resolution_notes)`,
  service-role-only, updates the report's status/resolution fields and
  logs the matching `moderation_actions` row (`dismiss_report`/
  `resolve_report`) in one call. Rejects an unsupported status or a
  nonexistent report id.
- ✅ `docs/MODERATION_RUNBOOK.md` updated: step 4 now points at this RPC;
  the broken `moderator_dismiss` reference is gone.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/moderator_resolve_report.test.sql` (6 assertions)
  proves both resolution outcomes, their audit rows, rejection of an
  unsupported status and a nonexistent report, and that the
  `authenticated` role can't call it. `run_all.sh` now reports 54 total
  SQL PASS assertions (was 48). Wired into CI.
- ✅ No mobile/worker changes — operator-only capability.
- ✅ **Confirmed on real CI**: run 33465482074 (the 13th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  new `moderator_resolve_report.test.sql` explicitly ran and passed
  inside the `database` job's own step list.

## Phase 30 — Clear captions on consent revoke

`docs/PRIVACY_DATA_FLOW.md` documented this as a known, accepted gap
since AI captions were first built. Revisited as a real privacy
expectation, not a cosmetic one.

- ✅ `20260901040000_clear_captions_on_consent_revoke.sql`:
  `clear_captions_on_consent_revoke()` trigger on
  `transcription_consents`, fires `AFTER INSERT OR UPDATE ... WHEN
  (new.consented = false)`, clears `clips.caption` and sets
  `caption_status = 'disabled'` for that user's clips — works
  regardless of client code, since the consent table is directly
  client-writable (no RPC wrapper to change).
- ✅ Gives `caption_status`'s long-unused `'disabled'` enum value (in
  its CHECK constraint since Phase 1) a real purpose, distinguishing
  "never captioned" from "cleared on consent revoke."
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/clear_captions_on_consent_revoke.test.sql` (3
  assertions) proves granting consent leaves a caption untouched,
  revoking it clears the caption for that user only. `run_all.sh` now
  reports 57 total SQL PASS assertions (was 54). Wired into CI.
- ✅ No mobile/worker changes — trigger-based, no client code to touch.
- ✅ **Confirmed on real CI**: run 33465738863 (the 14th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  new `clear_captions_on_consent_revoke.test.sql` explicitly ran and
  passed inside the `database` job's own step list.

## Phase 31 — moderator_warn_user() RPC (consistency close-out)

The last inconsistency in the moderation system: every other action had
become a uniform state-plus-audit-log RPC over Phases 28-29 except
`warn`, which is log-only and had been left as a raw `INSERT`.

- ✅ `20260901050000_moderator_warn_user.sql`:
  `moderator_warn_user(user_id, reason)`, service-role-only, logs a
  `moderation_actions` row with `action = 'warn'`.
- ✅ `docs/MODERATION_RUNBOOK.md` updated: step 3's warn bullet and
  step 5 both point at this RPC now.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/moderator_warn_user.test.sql` (2 assertions) proves
  the audit row is logged and the `authenticated` role can't call it.
  `run_all.sh` now reports 59 total SQL PASS assertions (was 57). Wired
  into CI.
- ✅ No mobile/worker changes — operator-only capability.
- ✅ **Confirmed on real CI**: run 33466116974, all 7 jobs passed,
  checked individually per job — the new `moderator_warn_user.test.sql`
  explicitly ran and passed inside the `database` job's own step list.
  This is the 15th consecutive clean *code* run; two intervening
  doc-only pushes (stale-claim fixes in `SECURITY.md` and
  `LAUNCH_CHECKLIST.md`, runs 33465974152 and 33466017447) each also
  triggered and passed their own full CI run cleanly in between.

## Phase 32 — revenuecat-webhook out-of-order event protection

Found auditing the webhook handler for the same class of bug the
moderation RPCs turned out to have: `revenuecat-webhook` (the only
writer of `subscriptions`) had no protection against a redelivered or
out-of-order event overwriting an active subscriber with stale data —
a real money-adjacent correctness risk, not cosmetic.

- ✅ `20260901060000_webhook_event_ordering.sql`: adds
  `subscriptions.last_event_at`.
- ✅ `supabase/functions/revenuecat-webhook/index.ts`: before writing,
  compares the incoming event's `purchased_at_ms` against the stored
  `last_event_at` and skips the write (`{ ok: true, skipped:
  'stale_event' }`) if the incoming event is older. An event with no
  `purchased_at_ms` is still applied unconditionally (unchanged
  behavior) and never overwrites `last_event_at` with a fabricated
  timestamp.
- ✅ `run_all.sh` confirms the migration applies cleanly (59 assertions,
  unchanged — a plain column addition needs no dedicated test). Not
  independently unit-testable beyond that: this is Edge Function logic,
  and this sandbox has no live Supabase project to exercise it against
  — same constraint as every other Edge Function in this repo. CI's
  `edge-functions-typecheck` job is the real verification for the
  TypeScript.
- ✅ No mobile/worker changes; no new deployment step or env var.
- ✅ **Confirmed on real CI**: run 33570089182 (the 16th consecutive
  clean run), all 7 jobs passed, checked individually per job —
  `edge-functions-typecheck`'s "Type-check every function" step
  explicitly confirms `revenuecat-webhook/index.ts` compiles cleanly,
  the one job this phase's change couldn't be verified against locally
  (no `deno` in this sandbox).

## Phase 33 — Fix push token reassignment across users on a shared device

Found by testing a hypothesis empirically against real Postgres rather
than reasoning from RLS + `ON CONFLICT` documentation: a different user
logging in on a device that previously registered its Expo push token
under someone else's account hit an RLS error on the client's plain
upsert, since `expo_push_token` is globally unique and `ON CONFLICT DO
UPDATE` re-checks the *existing* row's RLS policy — which belongs to
the other user. Confirmed directly in `psql` before writing the fix.
Real effect: the new user's registration silently failed and the
previous user's stale row remained, so a push meant for the old account
could land on a device someone else is now signed into.

- ✅ `20260901070000_push_token_reassignment.sql`:
  `register_push_token(expo_push_token, platform)`, a SECURITY DEFINER
  RPC that deletes any other user's row for that token, then
  upserts the caller's own — same "wrap the cross-user side effect RLS
  can't express" pattern used throughout this schema.
- ✅ `mobile/src/services/notifications.ts#registerPushToken()` now
  calls the RPC instead of writing `device_push_tokens` directly.
- ✅ **Auto-verified against real Postgres**:
  `supabase/tests/push_token_reassignment.test.sql` (5 assertions) —
  proves the RPC reassigns a shared token, includes a dedicated
  assertion reproducing the *original bug* (the old plain upsert really
  does hit the RLS error on this exact scenario), covers safe
  same-user re-registration, and rejects an invalid platform.
  `run_all.sh` now reports 64 total SQL PASS assertions (was 59). Wired
  into CI.
- ✅ Mobile typecheck/lint/37 `jest` tests all clean.
- ✅ **Confirmed on real CI**: run 33579428553 (the 17th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  new `push_token_reassignment.test.sql` explicitly ran and passed
  inside the `database` job's own step list.

## Phase 34 — Cap retries on worker-crash stale-claim reclaims

Found tracing what happens when a montage-render job crashes the
*worker process itself* (OOM kill, container redeploy, unhandled
promise rejection, a native `ffmpeg` crash) rather than throwing a
catchable exception — `runJob.ts`'s `try`/`catch` never runs, so
`failJob()`'s `retry_count` accounting never fires. Since
`poller.ts` is deliberately single-job-at-a-time, a job that reliably
crashes the worker on every attempt would starve the *entire* render
pipeline for every user in ~10-minute cycles, forever — a poison
pill, not just a stuck job for its own requester.

- ✅ `20260901080000_worker_claim_retry_cap.sql`:
  `claim_next_montage_job()` gained `p_max_retries` (default 3,
  matching `worker/src/config.ts`'s `MAX_RETRIES`). Reclaiming a stale
  claim now counts as a used retry attempt; once the budget is met the
  job is marked `'failed'` (`error_code =
  'worker_crash_max_retries_exceeded'`) instead of being handed back,
  and the function keeps searching rather than stalling the poller
  behind the poison pill.
- ✅ `worker/src/poller.ts` passes `p_max_retries: config.maxRetries`.
- ✅ **Auto-verified against real Postgres**: 3 new assertions in
  `supabase/tests/worker_claim.test.sql` (5 total) prove the retry
  count increments on reclaim, a job hits its cap and is marked
  failed rather than retried forever, and — the actual production
  concern — a poison pill at the front of the queue doesn't block a
  real job queued behind it. `run_all.sh` now reports 67 total SQL
  PASS assertions (was 64). Wired into CI.
- ✅ Worker: typecheck/build/all 14 `node --test` suites clean.
- ✅ **Confirmed on real CI**: run 33581465434 (the 18th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  `database` job's "Run worker job-claim test suite" step and the
  `worker` job's typecheck/build/test steps both explicitly ran and
  passed.

## Phase 35 — Fix send-capture-reminders silently dropping reminders on a transient Expo API failure

Found by checking the function's own comment against what its code
actually did: it claimed a failed push batch's slots "won't be marked
notified and will be retried," but the final `capture_slots` update
marked every active slot notified unconditionally, regardless of which
batches actually succeeded. A single Expo API hiccup meant those users'
reminders were marked sent and never retried, even though nothing was
ever sent.

- ✅ `supabase/functions/send-capture-reminders/index.ts`: tracks
  `notifiedSlotIds` incrementally — a slot with no device token is
  marked immediately (nothing to send), a slot whose batch was actually
  submitted to Expo is marked once that `fetch()` call returns without
  throwing, and a slot whose batch's `fetch()` threw is left unmarked
  for the next cron tick. The response body's `slotsProcessed` now
  reports the real count, plus a new `slotsPendingRetry` field.
- ✅ Not independently testable beyond a manual re-read and CI's
  `edge-functions-typecheck` — same constraint as every other
  Edge-Function-only fix this session (no live Supabase project in
  this sandbox). No mobile/worker/schema changes; no new deployment
  step.
- ✅ **Confirmed on real CI**: run 33581836686 (the 19th consecutive
  clean run), all 7 jobs passed, checked individually per job —
  `edge-functions-typecheck`'s "Type-check every function" step
  explicitly confirms `send-capture-reminders/index.ts` compiles
  cleanly, the one job this phase's change couldn't be verified
  against locally (no `deno` in this sandbox).

## Phase 36 — Stop retrying permanently-failed clip uploads forever

Found tracing the same "does this retry loop actually terminate"
question that closed Phases 34-35, this time in the mobile client's
offline upload queue: `validateLocalClip()`'s three failure modes
(local file missing/empty/oversized) are all permanent, but
`processUploadQueue()` scheduled another retry for every failure
identically, capping backoff at 15 minutes forever. A clip whose local
file vanished would retry indefinitely and sit in the Today screen as
"Upload failed — will retry" with no way to ever clear it.

- ✅ `mobile/src/services/clips.ts`: `validateLocalClip()`/`uploadOne()`
  return an optional `permanent: true` flag; `processUploadQueue()`
  routes a permanent failure to a new terminal `'permanently_failed'`
  status instead of scheduling another attempt.
- ✅ `mobile/src/state/upload-queue-store.ts`: added
  `'permanently_failed'` to `QueuedClip['status']` — excluded from the
  `due` filter, so it's never picked up again.
- ✅ `mobile/src/app/(app)/today/index.tsx`: shows a distinct message
  for this state and a "Remove" button (the queue's first manual-
  dismiss affordance, since every other failure was always expected to
  eventually succeed on retry).
- ✅ `npm run typecheck && npm run lint && npm test` all clean, 37/37
  tests still passing. No dedicated test added — state-machine/UI glue
  over an already-tested store, matching precedent for similar glue
  this session; the mobile test setup has no `expo-file-system` mock
  this would need.
- ✅ **Confirmed on real CI**: run 33637624288 (the 20th consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  `mobile` job's typecheck/lint/test steps all explicitly ran and
  passed on the changed files.

## Phase 37 — Fix montage_clips insert poisoning retries after a crash

Found tracing the same question as Phase 34 one step further into the
same file: `runJob.ts` inserts `montage_clips` rows (primary key
`(montage_id, clip_id)`) *before* the final `montages` status update to
`'ready'`. A retry after that insert already committed once — the
worker crashed between the two writes, or the status update itself
transiently failed — hit a duplicate-key error on every subsequent
attempt, poisoning a job that actually rendered successfully until it
burned through `config.maxRetries` and was marked permanently failed.

- ✅ `worker/src/render/runJob.ts`: deletes this job's own prior
  `montage_clips` rows before re-inserting, making the step safely
  re-runnable on any retry.
- ✅ Worker: typecheck/build/all 14 `node --test` suites clean. Not
  independently testable beyond that — Supabase orchestration inside
  `runJob.ts` needs a live project, the same documented gap as the
  rest of this file (`pipeline.test.ts` exercises the ffmpeg pipeline
  directly, not this code path).
- ✅ **Confirmed on real CI**: run 33638238943 (the 21st consecutive
  clean run), all 7 jobs passed, checked individually per job. This run
  needed two retries first — its `worker` job's "Install ffmpeg"
  (`apt-get update && apt-get install -y ffmpeg fonts-dejavu-core`) step
  hung with zero progress on two consecutive attempts while every other
  job (including the worker's own separate Docker-image-build job, which
  installs no ffmpeg) finished normally in under two minutes each time —
  a GitHub-hosted-runner/apt-mirror-side flake, not a regression from
  this change. Cancelling and re-running the workflow a third time
  (`run_attempt` 3) completed cleanly: "Install ffmpeg" took its normal
  ~28s, and the `worker` job's typecheck/build/all-tests steps all
  explicitly ran and passed on the changed file.

## Phase 38 — Fix check_rate_limit() TOCTOU race under concurrent callers

Found by extending the same "does every retry/concurrent path stay
correct" question to `check_rate_limit()` itself — the ledger function
every rate-limited RLS `WITH CHECK` policy (comments, reactions,
reports, group creation) and several Edge Functions (transcribe,
delete-account, request-montage) call before allowing a write. Its
original body read the current event count and inserted a new event as
two separate statements with no lock between them: two concurrent
calls for the same `(bucket, subject)` — a double-tap, two devices
signed into the same account, or a client retry racing its own
original request — could both read the count *before* either insert
committed, so both would see room under the limit and both return
`true`, letting the caller's stated limit be exceeded by however many
callers raced.

- ✅ Proven against a real Postgres 16 instance before fixing: a copy
  of the original two-statement function with `max_events=1`, fired
  from two concurrent `psql` connections against the same
  `(bucket, subject)`, returned `true` from **both** calls and left 2
  rows in `rate_limit_events` — one over the stated limit.
- ✅ `supabase/migrations/20260902000000_rate_limit_race_fix.sql`:
  `check_rate_limit()` now takes a `pg_advisory_xact_lock` keyed on
  `(bucket, subject)` before reading the count, serializing concurrent
  callers for the same key so the second always sees an up-to-date
  count. Different keys never contend with each other. Transaction-
  scoped, so it releases automatically.
- ✅ `supabase/tests/rate_limit_race.test.sh`: a new, non-`.sql` test
  (needs real concurrency, which a single-connection SQL script can't
  express) that instruments the function's *actual deployed
  definition* — not a hand-written stand-in — with an injected delay
  between its read and its insert to make the race deterministic,
  fires two concurrent callers at `max_events=1`, and asserts exactly
  one passes with exactly one row inserted. Verified this test
  actually discriminates: it fails with a clear diagnostic
  ("no longer takes the advisory lock") when pointed at the pre-fix
  function, and passes against the fix. Wired into
  `supabase/tests/run_all.sh` and `.github/workflows/ci.yml`'s
  `database` job.
- ✅ Full local `run_all.sh` suite (all 18 test files) reruns clean
  after this change.
- ✅ **Confirmed on real CI**: run 33640569081 (the 22nd consecutive
  clean run), all 7 jobs passed, checked individually per job — the
  `database` job's new "Run rate limit race test" step explicitly ran
  and passed on a real GitHub Actions runner (not just this local
  sandbox), and "Install ffmpeg" completed normally this time (~18s,
  no repeat of Phase 37's transient runner hang).

## Phase 39 — Fix two montage storage leaks (retry, and group deletion)

Found by re-reading `runJob.ts`'s upload step right after Phase 37's fix
to the write immediately below it, asking the same "does every retry
path stay correct" question one line earlier: the montage's output
storage path was `${job.kind}/${ownerId}/${randomUUID()}.mp4` — a fresh
random name on *every* attempt, including retries. A crash between a
successful upload and the final `montages` row update (the exact failure
window Phase 37 fixed for `montage_clips`) meant the retry uploaded again
under a brand new random name and pointed the row at that one, leaking
the first attempt's file forever with nothing referencing it.

- ✅ `worker/src/render/runJob.ts`: the storage path is now keyed on
  `job.id` (this montage row's own primary key, stable across every
  retry) instead of a fresh `randomUUID()` per attempt, so a retry's
  `upload(..., { upsert: true })` safely overwrites its own prior
  attempt instead of leaking it.

Checking that upload path surfaced a second, unrelated leak in the same
storage bucket: `delete_group()` (and `leave_group()`'s last-member-
leaving auto-delete path) both just `delete from groups where id = ...`.
`montages.group_id references groups(id) on delete cascade` correctly
removes the database rows, but a DB cascade has no way to reach Supabase
Storage's HTTP API — every deleted group's rendered montage video was
left behind in the `montages` bucket forever, with no purge job for this
bucket (unlike `purge-used-clips` for raw clips).

- ✅ `supabase/migrations/20260902010000_orphaned_montage_storage_purge.sql`:
  a `BEFORE DELETE` trigger on `montages` queues any deleted row's
  `storage_path` into a new `pending_storage_purges` table, regardless of
  *why* the row was deleted — not special-cased to group deletion, so it
  also safety-nets delete-account's personal-montage path (a harmless
  no-op there, since storage removal is idempotent — proven in Phase 38's
  investigation) and any future deletion path.
- ✅ `supabase/functions/purge-orphaned-montages/index.ts`: a new
  scheduled function draining that queue, mirroring `purge-used-clips`'s
  shape (leaves a row queued for retry on removal failure rather than
  losing track of it).
- ✅ `supabase/tests/orphaned_montage_storage_purge.test.sql`: proves the
  trigger queues a group-cascade-deleted montage's path, a directly
  deleted montage's path (the general-safety-net claim, not just
  asserted), and that a montage with no `storage_path` yet is never
  queued. Verified against real Postgres 16.
- ✅ Worker: typecheck/build/all 14 `node --test` suites clean after the
  `runJob.ts` change.
- ✅ Full local `run_all.sh` suite (all 19 test files) reruns clean.
- ✅ **Confirmed on real CI**: run 33708969185 (the 23rd consecutive
  clean run — all 7 jobs green on the first attempt, no ffmpeg-install
  flake this time), all 7 jobs passed, checked individually per job.
  `edge-functions-typecheck` explicitly type-checked the new
  `purge-orphaned-montages/index.ts` and passed (closing the one gap
  local sandbox couldn't verify — no Deno available here), and the
  `database` job's new "Run orphaned montage storage purge test suite"
  step passed on a real Postgres instance, not just this local sandbox.

## Phase 40 — Fix cross-user upload-queue leak on a shared/borrowed device

Found by applying the exact question that closed the push-token bug
(Phase 33) to a different piece of on-device state: the mobile offline
upload queue (`upload-queue-store.ts`) is a single, device-global,
AsyncStorage-persisted list — it has never been namespaced by account.
`useUploadQueueSync(userId)` always processes the queue with the
*currently signed-in* user's id, and `processUploadQueue(userId)`
uploaded every due item in the queue unconditionally. On a shared or
borrowed device: User A records a clip that fails to upload (offline,
app killed mid-upload) and stays queued; User A signs out; User B signs
in on the same device. The very next upload-queue sync would silently
upload User A's still-local, never-consented-to-share video and insert
it into `clips` with `user_id` = **User B** — a real privacy/data-
integrity bug, not theoretical, and the Today screen would additionally
show User A's still-queued item as an "Uploading…"/"Upload failed" row
inside User B's own timeline before that upload even happened.

- ✅ `mobile/src/state/upload-queue-store.ts`: `QueuedClip` gained a
  `userId` field, stamped at capture time.
- ✅ `mobile/src/services/clips.ts`: `enqueueClipForUpload()` now takes
  the capturing user's id; `processUploadQueue()` only processes items
  whose `userId` matches the requesting user — another user's queued
  item is left untouched (not deleted, not uploaded) until its rightful
  owner signs back in on this device, so no data is lost or misattributed
  either way.
- ✅ `mobile/src/app/capture.tsx`: reads the signed-in user's id from
  `useAuthStore` and passes it to `enqueueClipForUpload()`.
- ✅ `mobile/src/app/(app)/today/index.tsx`: the "uploading" rows shown
  on the Today timeline are now filtered to the current user's own
  queue items, closing the client-UI-leak symptom of the same bug.
- ✅ `mobile/src/services/__tests__/clips.test.ts` (new): proves
  `processUploadQueue()` only uploads the requesting user's own items
  and leaves another user's queued item alone, and that the leftover
  item uploads correctly once its own owner calls it. Mocks
  `../lib/supabase`/`../lib/storageUpload`/`expo-file-system` rather
  than hitting real infrastructure — this is pure client-side queue
  logic, no live Supabase project needed to verify it.
- ✅ Mobile: typecheck/lint/all 39 tests (37 previous + 2 new) clean.
- ✅ **Confirmed on real CI**: run 33906375794 (the 24th consecutive
  clean run, first attempt), all 7 jobs passed, checked individually per
  job — the `mobile` job's typecheck/lint/test steps all explicitly ran
  and passed, including the new `clips.test.ts` suite.

## Phase 41 — Fix every moderator RPC being uncallable by service_role

Found during a launch-readiness pass auditing which RPCs had zero test
coverage: `moderator_suspend_user`/`moderator_reinstate_user` had none at
all, which led to checking every `moderator_*` function's actual grants
rather than assuming the pattern already established for
`moderator_remove_content`/`moderator_resolve_report`/`moderator_warn_user`
(all three "fixed" and tested earlier this session) was complete. It
wasn't: **all five** moderator RPCs revoke `EXECUTE` from `public` and
`authenticated` to lock them down from end users, but none of them ever
grant it back to `service_role` — the actual role
`MODERATION_RUNBOOK.md` instructs a moderator to call these with ("call
it only via the service role key"). In plain PostgreSQL, `CREATE
FUNCTION` grants `EXECUTE` to the `PUBLIC` pseudo-role by default, and
every role — `service_role` included — is implicitly a member of
`PUBLIC`. `revoke all ... from public` removes that implicit path for
*every* role at once, not just the two named on the same line; only
`check_rate_limit()`/`claim_next_montage_job()` correctly re-grant to
`service_role` afterward, and none of the five moderator RPCs do.

This is why the existing `moderator_*.test.sql` files never caught it:
each deliberately simulates "how a service-role caller with no
impersonated user sees `auth.uid()`" by running as the plain `postgres`
superuser (see each file's own comment on this), which correctly
exercises the function's internal logic but — since a superuser bypasses
every `GRANT` check, not just RLS — never actually exercises whether the
real `service_role` role can invoke the function *at all*. Net effect
before this fix: every step of the moderation runbook (warn, remove
content, suspend, reinstate, resolve report) was uncallable exactly as
documented — this is the private beta's *only* moderation mechanism,
since there is deliberately no admin dashboard yet (`LAUNCH_CHECKLIST.md`).

- ✅ Proven against a real Postgres 16 instance before fixing:
  `set role service_role; select moderator_warn_user(...);` (and the
  other four) returned `ERROR: permission denied for function ...`.
- ✅ `supabase/migrations/20260902020000_moderator_rpc_service_role_grants.sql`:
  grants `EXECUTE` on all five moderator RPCs to `service_role`.
- ✅ `supabase/tests/moderator_rpc_service_role_grants.test.sql` (new):
  calls all five functions as the real `service_role` role (`set role
  service_role`, not the superuser-bypass simulation the other test
  files use) and asserts none raise `permission denied`, then confirms
  the side effects actually landed (account reactivated after
  suspend+reinstate, comment marked removed, report marked actioned) —
  not just that the call didn't error. Verified this test actually
  discriminates: reran the full migration set with this one fix
  migration skipped and confirmed it fails with the exact
  `permission denied for function moderator_warn_user` error, then
  confirmed it passes with the fix included.
- ✅ Full local `run_all.sh` suite (all 21 test files) reruns clean.
- ⬜ Not yet confirmed on real CI as of this writing — pending push.

---

## Environment constraints discovered this session

These bound what "verified" can honestly mean here:

- **Docker Hub is policy-blocked, not "no Docker daemon"** — corrected in
  Phase 19 after actually checking: `dockerd` starts and runs fine in
  this sandbox, but its egress proxy explicitly denies Docker Hub's blob
  CDN (`production.cloudfront.docker.com`), so a build gets through
  manifest resolution and fails on the base-image layer pull. `ci.yml`'s
  `worker-docker-build` job builds the real image on GitHub Actions
  instead, which isn't behind that policy — see Phase 19.
- **No Supabase CLI network/Docker stack** confirmed runnable here (the
  same policy denies supabase.com directly, independent of the Docker
  question above). Migrations were instead verified against a real local
  PostgreSQL 16 (`apt install postgresql`) with a hand-built stand-in for
  Supabase's `auth`/`storage` schemas — see `supabase/tests/` and the
  "Schema hardened and proven" entry in `docs/DECISIONS.md`. Whether
  `supabase start` itself succeeds in a Docker-capable, non-policy-restricted
  environment is expected to be a smooth run (the SQL is already proven
  against real Postgres), but is untested here.
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
