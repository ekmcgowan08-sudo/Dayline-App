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
- 🟡 **Server-side push notification delivery**: device token registration
  code exists (`registerPushToken`) and is called after schedule setup,
  but nothing in this repo yet *sends* a push (that requires either a
  scheduled Edge Function or a third-party pusher hitting Expo's push
  API) — local notifications are the only reminder path that actually
  fires today. Tracked as a real gap, not glossed over.

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

Status: not started.

## Phase 5 — Memories, exports, settings, deletion, privacy

Status: not started.

## Phase 6 — Subscriptions & optional AI features

Status: not started.

## Phase 7 — Security hardening, tests, CI, performance, a11y

Status: not started.

## Phase 8 — Deployment config, launch docs, final audit

Status: not started.

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
