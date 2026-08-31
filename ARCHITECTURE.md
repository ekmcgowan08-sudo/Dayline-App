# Architecture

## System overview

```
┌────────────────┐   anon/user JWT    ┌──────────────────────────┐
│  Mobile app     │ ─────────────────▶ │  Supabase                │
│  (Expo/RN)      │ ◀── RLS-scoped ──  │  - Postgres + RLS        │
│                 │      data,          │  - Auth                  │
│                 │      signed URLs    │  - Storage (private)     │
└───────┬─────────┘                    │  - Realtime               │
        │ supabase.functions.invoke    │  - Edge Functions (Deno)  │
        ▼                              └─────────────┬─────────────┘
┌────────────────┐                                    │ service role
│  Edge Functions │ ───────────────────────────────────┘
│  (trusted)      │
│  request-montage, get-montage-url, delete-account,
│  revenuecat-webhook, transcribe
└────────────────┘

┌────────────────┐   polls montages table (service role)
│  Render worker  │ ─────────────────────────────────────────▶ Postgres + Storage
│  (Node + ffmpeg,│   downloads clips, renders, uploads result
│   containerized)│
└────────────────┘
```

## Why this stack (see `docs/DECISIONS.md` for the full reasoning trail)

- **Expo + React Native + TypeScript**: single codebase for iOS/Android,
  fast iteration, mature camera/notification/video module support.
- **Expo Router** over bare `@react-navigation`: Expo's current
  officially-recommended routing system (file-based, typed routes,
  protected-route layouts, deep linking) — chosen for a greenfield build,
  not a migration away from anything that existed.
- **Supabase** over Firebase: real SQL (clean group/permission joins),
  Row Level Security maps directly onto "private by default" media,
  Postgres gives a real migration story via `supabase/migrations/`.
- **A standalone render worker, not client-side rendering**: video
  composition on-device is slow and inconsistent across iOS/Android and
  hard to make idempotent/retryable. A server-side worker can be polled,
  retried, dead-lettered, and tested against fixture videos independent
  of the mobile app.
- **RevenueCat** for subscriptions: the current standard cross-platform
  entitlement layer for Expo apps, with a documented webhook contract
  Supabase can consume as the entitlement source of truth.

## Data flow: personal montage

1. App calls `request-montage` (`{scope: 'personal'}`), authenticated by
   the user's session JWT.
2. The function verifies the caller, rate-limits, checks for an existing
   montage row for (user, today) — idempotent: returns the existing job
   if one's already processing/ready, or resets a failed one to retry —
   otherwise inserts a new `processing` row after confirming at least one
   eligible clip exists.
3. The render worker's poll loop claims the row
   (`claim_next_montage_job()`, `FOR UPDATE SKIP LOCKED` — safe under
   concurrent workers), re-queries eligible clips fresh (never trusting a
   stale snapshot), downloads each from the private `clips` bucket via
   the service role, normalizes+concatenates them with ffmpeg, uploads
   the result to the private `montages` bucket, records
   `montage_clips` (final order + which clips actually made it in), and
   flips the row to `ready`.
4. The app either gets a Realtime `postgres_changes` push or polls,
   fetches a signed playback URL via `get-montage-url` (which re-checks
   authorization server-side — never a direct client bucket read), and
   plays it.

## Data flow: group montage ("Our Day")

Identical to the above, except: (a) eligibility is `group_contributions`
rows (a clip's owner explicitly opted it into that specific group — group
membership alone is never sufficient), and (b) `get-montage-url` checks
group membership instead of ownership. See
`worker/src/render/fetchEligibleClips.ts` for the authoritative query.

## Security model

Everything is RLS-first: a user can only ever see their own clips, their
own or accessible group montages, and roster rows for groups they're in.
The client's anon/session key can never read another user's private data
because Postgres enforces it, not client code — proven in
`supabase/tests/rls_security.test.sql` against a real Postgres instance,
not just asserted. Full threat model: `docs/SECURITY.md`.

## Capture scheduling

Reminder times are computed client-side
(`mobile/src/services/schedule.ts`) as wall-clock times in the user's
IANA timezone, converted to UTC instants via `date-fns-tz`'s
`fromZonedTime` — this is what makes scheduling correct across DST
transitions (proven in a unit test using a real America/New_York EST↔EDT
boundary). Computed slots are mirrored into `capture_slots` (so the Today
timeline has a durable, server-visible record independent of whether a
local notification survives an app kill) and scheduled as local
notifications via `expo-notifications`. A `send-capture-reminders`
Edge Function is the backup delivery path (so a reminder survives an app
kill/reinstall) — it reads the same `capture_slots` rows rather than
recomputing the schedule, and a shared `captureSlotId` between the local
and server notification lets the client suppress a duplicate display
(`mobile/src/lib/notificationDedup.ts`) if it sees both. See
`docs/IMPLEMENTATION_STATUS.md` (Phase 9) for exactly what's verified and
`docs/DEPLOYMENT.md` for the one-time `pg_cron` scheduling step a real
project needs.

## What's deliberately NOT in this architecture

- No public feed, ranking algorithm, or follower graph — there's nowhere
  in the schema for one to live.
- No ad SDK, no third-party tracking/attribution SDK.
- No client-side entitlement storage as a source of truth — the
  `subscriptions` table (server-only writes) is always the real answer;
  see `mobile/src/state/subscription-store.ts`'s comments for how the
  dev-mode mock adapter is kept from ever pretending otherwise.
