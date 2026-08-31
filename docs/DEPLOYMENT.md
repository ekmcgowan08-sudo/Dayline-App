# Deployment

## Local development (no production credentials needed)

```bash
# 1. Mobile app
cd mobile
cp .env.example .env        # fill in a Supabase project's URL + anon key
npm install
npm start                    # then press i / a / w, or scan the QR in Expo Go

# 2. Database (against a real Supabase project's SQL editor, or the CLI)
supabase link --project-ref <your-project-ref>
supabase db push              # applies everything in supabase/migrations/

# 3. Storage buckets (created by migration 20260831060000 + 20260831090000
#    for clips/montages/avatars — verify they exist in the dashboard after
#    db push; bucket creation via SQL requires the storage extension to be
#    enabled, which it is by default on every Supabase project)

# 4. Edge Functions
cd supabase
supabase functions deploy request-montage
supabase functions deploy get-montage-url
supabase functions deploy delete-account
supabase functions deploy revenuecat-webhook --no-verify-jwt
supabase functions deploy transcribe
supabase secrets set --env-file functions/.env   # after filling in real values

# 5. Render worker
cd worker
cp .env.example .env         # fill in the SAME project's URL + SERVICE ROLE key
npm install && npm run build
npm start                     # or: docker build -t dayline-worker . && docker run --env-file .env -p 8080:8080 dayline-worker
```

The app, database, and worker are designed to work together against a
**local Supabase stack** (`supabase start`, which needs Docker) without
any production accounts — see `docs/TESTING.md` for why that specific
combination (real `supabase start` + this repo's migrations) wasn't
exercised in this development sandbox (no Docker daemon here), even
though the SQL itself is proven against real Postgres.

## Production deployment runbook

1. **Supabase project** (owner action — see `docs/OWNER_ACTIONS_REQUIRED.md`):
   create a production project, note its URL/anon key/service role key.
2. `supabase link --project-ref <prod-ref> && supabase db push` — applies
   every migration in order. Migrations are additive/idempotent-by-design
   (`if not exists` / `create or replace` throughout) so re-running is
   safe.
3. Deploy Edge Functions (same commands as above, against the linked
   prod project) and set secrets via `supabase secrets set`.
4. Deploy the render worker container to a Docker-capable host (see
   `COSTS.md` for current pricing on a few options) with its own `.env`
   pointing at the production project's service role key. Point its
   `/health` endpoint at whatever uptime monitor you use.
5. Configure RevenueCat: create products in App Store Connect / Play
   Console, mirror them in the RevenueCat dashboard, set the `plus`
   entitlement identifier (must match `REVENUECAT_ENTITLEMENT_ID` in
   `mobile/src/constants/entitlements.ts`), set the webhook URL to your
   deployed `revenuecat-webhook` function with a shared secret matching
   `REVENUECAT_WEBHOOK_SECRET`.
6. Build the mobile app with EAS (see `mobile/eas.json` — development,
   preview, and production profiles) and submit via `eas submit`.
7. Point `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`/
   RevenueCat keys at production values for the production build profile
   specifically (never bake production credentials into the development
   profile a wider group might run).

## Rollback

- **Mobile app**: EAS supports rolling back to a previous build/update
  channel; app-store binary rollback requires a new store submission
  (Apple/Google don't support instant binary rollback) — an EAS Update
  (OTA JS-only fix) is the fast path for non-native-code issues.
- **Database**: migrations in this repo are additive (no destructive
  `drop table`/`drop column` anywhere) specifically so a bad migration can
  be fixed forward with a new migration rather than requiring a rollback.
  If a genuinely destructive rollback is ever needed, restore from a
  Supabase point-in-time backup (Pro plan+) rather than hand-reversing SQL.
- **Edge Functions**: `supabase functions deploy <name>` on a previous git
  commit redeploys the prior version; keep function code in git history
  (it already is) rather than editing live in the dashboard.
- **Render worker**: redeploy the previous container image tag.

## Backup & recovery

- Supabase Pro-tier projects include daily backups + point-in-time
  recovery; confirm this is enabled once a production project exists
  (free-tier projects do not include PITR).
- Storage buckets (clips/montages/avatars) are not separately backed up
  by this repo's tooling — they rely on Supabase Storage's own
  durability. Consider a periodic export to a second bucket/provider once
  real user data exists, especially before any risky migration.

## Monitoring & alerting recommendations

- **Render worker**: point an uptime monitor (even a free one) at
  `/health`; alert on `lastError` being non-null for more than a few
  poll cycles, which the endpoint already exposes.
- **Supabase**: the dashboard's built-in Postgres/API/Storage metrics;
  set up an alert on error-rate spikes and on `rate_limit_events` volume
  (a sudden spike suggests an attack or a client bug hammering an
  endpoint).
- **Edge Functions**: Supabase's function logs; consider forwarding to a
  log aggregator once volume justifies it.
- **Mobile**: crash reporting (e.g., Sentry) is not wired into this build
  — recommended before public launch, tracked in `docs/OWNER_ACTIONS_REQUIRED.md`.

## Secret management

- Local dev: `.env` files, gitignored everywhere in this repo.
- CI: GitHub Actions repository secrets (none are currently referenced by
  `.github/workflows/ci.yml`'s jobs, which all run against ephemeral/mock
  state — add secrets there only if a future job needs to hit a real
  service).
- Production: Supabase project secrets (`supabase secrets set`) for Edge
  Functions; the render worker's host's own secret/env mechanism (varies
  by provider — see `COSTS.md`); EAS's own secret store
  (`eas secret:create`) for anything baked into a mobile build profile.
