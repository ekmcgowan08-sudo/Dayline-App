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

Status: not started.

## Phase 3 — Personal montage rendering & reveal

Status: not started.

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
- **No Supabase CLI network/Docker stack** confirmed runnable here — migrations
  are written as plain SQL and reviewed for correctness; whether `supabase
  start` succeeds in this exact sandbox is tracked below once attempted.
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
