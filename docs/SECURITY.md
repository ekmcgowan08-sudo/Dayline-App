# Security & Threat Model

This document describes Dayline's security architecture and the specific
threats it defends against, what's actually verified vs. reviewed-only,
and known accepted risks. See `docs/IMPLEMENTATION_STATUS.md` for the
verification tier on every claim below (Auto / Sim / Device / ProdCreds).

## Trust boundaries

```
┌─────────────┐        anon/authenticated key        ┌──────────────┐
│ Mobile app  │ ────────────────────────────────────▶ │  Supabase    │
│ (untrusted  │        (RLS enforces everything)       │  Postgres +  │
│  client)    │ ◀──── signed URLs, RPC results ──────  │  Storage     │
└─────────────┘                                        └──────┬───────┘
                                                                │ service
      │ HTTPS, per-request JWT                                │ role key
      ▼                                                        ▼
┌─────────────┐                                        ┌──────────────┐
│ Edge        │ ── service role (full access) ───────▶ │  Postgres +  │
│ Functions   │                                         │  Storage     │
│ (trusted)   │                                         └──────────────┘
└─────────────┘
      ▲
      │ polling, service role key
┌─────────────┐
│ Render      │
│ worker      │
│ (trusted)   │
└─────────────┘
```

**The mobile app is always untrusted.** It holds only the anon/publishable
key and a user's own session JWT. Every guarantee in this document holds
even if the app's source code, API calls, and request bodies are fully
known to an attacker (they are — it's a public mobile app).

**Edge Functions and the render worker are trusted.** They hold the
Supabase service role key, which bypasses Row Level Security entirely.
This key must never appear in the mobile app bundle, git history, or
client-readable config — see the Secrets section below.

## What Row Level Security actually enforces

Every user-data table has RLS enabled with explicit per-operation
policies (see `supabase/migrations/`). The nine guarantees below are not
just claimed — they're proven by running `supabase/tests/rls_security.test.sql`
against a real Postgres 16 instance impersonating different users under
the (non-superuser, non-bypassrls) `authenticated` role, exactly as
PostgREST enforces them in production:

1. A user cannot read, update, or delete another user's raw clips.
2. A nonmember cannot read a group's montage.
3. A member removed from a group immediately loses access to its montage.
4. A group cannot exceed 10 active members, even under concurrent join
   attempts (`FOR UPDATE` row-locks the group row during the check).
5. Invite-code brute-forcing is rate-limited (20 attempts / 10 minutes /
   user) via a ledger a client cannot read, write, or clear.
6. A client cannot grant itself a paid entitlement — the `subscriptions`
   table has zero client-facing INSERT/UPDATE policy; only the service
   role (from `revenuecat-webhook`) can write it.
7. A client cannot change moderation status on content — comments have no
   client UPDATE policy at all; only `moderate_delete_comment()` (which
   itself checks the caller is the content owner or a group owner/admin)
   can change it.
8. Blocking is enforced in the database, not just client-side filtering:
   blocked users' comments/reactions are mutually hidden via a
   `blocked_between()` check baked into the RLS policy, and
   `join_group_by_code()` refuses a join if the joiner has a block
   relationship with any current member.
9. Montage playback requires server-side authorization — the `montages`
   storage bucket has **zero** client-facing policies. A client's own
   session, however constructed, cannot read it; only an Edge Function
   using the service role (after checking ownership/membership itself)
   can mint a signed URL.

Run it yourself: `bash supabase/tests/run_all.sh` (needs a local Postgres;
see `docs/TESTING.md`).

### Bugs this actually caught (not hypothetical)

Three real, load-bearing security bugs were found only by running these
tests against real Postgres, not by reading the SQL — documented in full
in `docs/DECISIONS.md`:
- **RLS self-recursion** on `group_members`'s own SELECT policy (fixed
  with a SECURITY DEFINER helper).
- **A rate limiter that could never actually rate-limit**, because its
  log-then-raise pattern rolled back its own log entry on every failure
  (fixed by returning a result object instead of raising for expected
  outcomes — see the comment in `join_group_by_code()`).
- **A missing `WITH CHECK`** on the recovered baseline's reactions/
  comments policies that would have let any montage viewer insert a
  comment claiming to be a different user.

## Storage design

- Every bucket (`clips`, `montages`, `avatars`) is private except
  `avatars`, which is intentionally public-read (low-sensitivity,
  user-chosen photos other group members legitimately need to see) —
  writes are still owner-scoped.
- Object paths use random UUIDs, not user id + timestamp (which the
  recovered baseline used and which is guessable within a user's own
  folder prefix — not a real vulnerability since RLS still gates the
  folder, but unguessable-by-convention is cheap defense in depth).
- Signed URLs are short-lived: 10 minutes for clips, 30 minutes for
  montages, generated server-side only, after an authorization check.

## Idempotency & abuse resistance

- **Clip uploads**: a client-generated `client_capture_id` UUID with a
  unique index makes retried uploads idempotent (upsert, not duplicate).
- **Montage requests**: `request-montage` is idempotent per (owner, date)
  — a unique partial index means there can only ever be one montage row
  per user per day or per group per day; a retried request returns the
  existing row's status instead of creating a duplicate render job.
- **Worker job claims**: `claim_next_montage_job()` uses `FOR UPDATE SKIP
  LOCKED` so concurrent worker instances can never double-process a job —
  proven in `supabase/tests/worker_claim.test.sql`, including stale-claim
  reclamation after a simulated worker crash.
- **Rate limiting**: `check_rate_limit()` backs invite-code redemption,
  `request-montage`, `delete-account`, `transcribe`, and report filing.
  Sensitive Edge Functions all call it before doing real work.

## Secrets

- The Supabase **service role key** lives only in: the render worker's own
  environment (`worker/.env`, never committed), and Supabase's own Edge
  Function runtime (injected by the platform, or set via
  `supabase secrets set` for local `functions serve` — see
  `supabase/functions/.env.example`). It is never referenced from
  `mobile/`.
- The mobile app only ever holds the Supabase **anon key** (`EXPO_PUBLIC_
  SUPABASE_ANON_KEY`) and RevenueCat's public platform API keys — both are
  designed to be safe in a client bundle.
- `OPENAI_API_KEY` and `REVENUECAT_WEBHOOK_SECRET`, if set, are Edge
  Function-only secrets, never bundled into the app.
- `.gitignore` excludes `.env` everywhere in this repo; `.env.example`
  files document variable names only, never real values.
- CI runs `npm audit --audit-level=high` (mobile + worker) and a
  `gitleaks` secret scan on every push/PR (see `.github/workflows/ci.yml`)
  — neither has been exercised on GitHub's own infrastructure in this
  session (no outbound access to actions.github.com from this sandbox),
  but both were validated for correct syntax and the underlying commands
  (`npm audit`, gitleaks' default ruleset) run clean against this repo's
  current dependency tree.

## Known accepted risks

- **12 moderate-severity npm advisories** in the mobile app's dependency
  tree, all inside Expo's own build-time tooling
  (`@expo/config-plugins` and packages that depend on it) — not shipped
  runtime code, and not fixable without `npm audit fix --force` pulling in
  breaking Expo SDK changes. Re-check on the next Expo SDK bump.
- **No production-verified Edge Functions.** Every Edge Function in this
  repo was written, reviewed, and type-checked, but this sandbox has no
  live Supabase project to actually invoke them against. Treat as
  reviewed-but-unverified until run once against a real project (see
  `docs/OWNER_ACTIONS_REQUIRED.md`).
- **Immediate (not grace-period) account deletion.** See the dedicated
  entry in `docs/DECISIONS.md` — there is no scheduler in this build to
  enforce a delayed purge honestly, so deletion is immediate instead of
  promising a grace period nothing enforces.
- **Data export is request-only**, not yet auto-fulfilled — see
  `docs/PRIVACY_DATA_FLOW.md`.

## Reporting a vulnerability

Until a dedicated security contact exists, report to the support address
in `src/constants/brand.ts` (`support@dayline.app` as of this writing —
see `docs/OWNER_ACTIONS_REQUIRED.md` for making this a real, monitored
inbox before launch).
