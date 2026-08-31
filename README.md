# Dayline

*"Don't perform your life. Remember it."*

A private, close-friend-group-first micro-vlogging app. Capture a few
five-second moments through your day, get an automatic private daily
montage, and optionally share it with a small group of up to 10 close
friends as "Our Day." No public feed, no follower counts, no algorithmic
ranking.

"Dayline" is a working name pending trademark/domain clearance — see
`docs/STORE_SUBMISSION.md`'s checklist. It's centralized in
`mobile/src/constants/brand.ts` so it's a one-file rename if needed.

## Repository layout

```
mobile/     Expo SDK 57 / React Native app (the client)
supabase/   Postgres schema (migrations/), Edge Functions (functions/), SQL tests (tests/)
worker/     Containerized Node + ffmpeg montage-rendering worker
docs/       Implementation status, decisions, security, testing, deployment, legal drafts
```

See also, at the repo root: `ARCHITECTURE.md`, `PRODUCT.md`, `ROADMAP.md`,
`COSTS.md`, `LAUNCH_CHECKLIST.md`, `TERMS.md`, `PRIVACY.md`,
`COMMUNITY_RULES.md`.

## Current status

Read `docs/IMPLEMENTATION_STATUS.md` first — it's the single source of
truth for what's actually built, what's actually verified (and how), and
what's a known, honestly-labeled gap. Short version: every phase of the
product spec has real, working code (not stubs or fake buttons); the
parts that could be run in this development sandbox (schema/RLS security
tests against real Postgres, the ffmpeg render pipeline against real
video, unit/component tests, `npm`/`eslint`/`tsc`) were actually run, not
just written; the parts that need a live Supabase project, Docker, a
physical device, or production credentials were not (this sandbox had
none of those) and are labeled as such rather than claimed.

## Prerequisites

- Node.js 22+, npm
- A [Supabase](https://supabase.com) project (free tier is enough for
  development) — or the Supabase CLI + Docker for a fully local stack
- [Expo Go](https://expo.dev/go) (fastest way to run the app on a real
  device) or an iOS Simulator / Android Emulator
- Docker, if you want to run the render worker in its container (it also
  runs directly with `node`/`npm` for local development without Docker)
- `ffmpeg` installed locally if running the worker outside Docker
  (`apt install ffmpeg` / `brew install ffmpeg`)

## Quickstart (local development)

```bash
# 1. Mobile app
cd mobile
cp .env.example .env            # fill in your Supabase project URL + anon key
npm install
npm start

# 2. Database
supabase link --project-ref <your-project-ref>
supabase db push                 # applies every migration in supabase/migrations/

# 3. Edge Functions (optional for basic UI browsing; required for montages/deletion/subscriptions/AI captions to work)
cd supabase
supabase functions deploy request-montage
supabase functions deploy get-montage-url
supabase functions deploy delete-account
supabase functions deploy revenuecat-webhook --no-verify-jwt
supabase functions deploy transcribe

# 4. Render worker (needed for montages to actually finish rendering)
cd worker
cp .env.example .env             # same Supabase project's URL + SERVICE ROLE key
npm install
npm run build && npm start       # or: docker build -t dayline-worker . && docker run --env-file .env -p 8080:8080 dayline-worker
```

Full detail, including a fully-local (no production account) setup path
using the Supabase CLI, is in `docs/DEPLOYMENT.md`.

## Testing

```bash
bash supabase/tests/run_all.sh          # schema + RLS security proofs (needs local Postgres)
cd mobile && npm run typecheck && npm run lint && npm test
cd worker && npm run typecheck && npm run build && npm test  # needs ffmpeg installed
```

See `docs/TESTING.md` for what each suite actually proves, and exactly
what remains unverified in this environment (camera/device flows, live
Supabase calls, Docker image build, RevenueCat's live webhook shape).

## Stack

Expo SDK 57 (React Native 0.86, React 19.2, TypeScript), Expo Router,
Supabase (Postgres + Auth + Storage + Edge Functions + Realtime), a
standalone Node.js + ffmpeg render worker, RevenueCat for subscriptions.
See `ARCHITECTURE.md` for the full picture and `docs/DECISIONS.md` for
why each choice was made (including what was inherited from the
recovered prototype vs. replaced).

## Contributing / resuming this work

Read, in order: `docs/IMPLEMENTATION_STATUS.md` (what's done, what's
next), `docs/DECISIONS.md` (why things are the way they are, including
three real bugs found by actually running the tests), then the specific
area you're touching. `docs/OWNER_ACTIONS_REQUIRED.md` is the single
consolidated checklist of everything that needs a human with real
account access, payment authorization, or legal judgment — nothing else
should be blocked on the owner.
