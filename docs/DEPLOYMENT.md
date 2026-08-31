# Deployment

## The fast path: GitHub Actions

Before typing any command below by hand, check `docs/OWNER_ACTIONS_REQUIRED.md`'s
"The fast path" section — `deploy-supabase.yml`, `eas-build.yml`, and
`verify-sentry.yml` in `.github/workflows/` automate everything here once
you've created the relevant accounts and pasted their tokens into this
repo's GitHub secrets. Everything below is the manual equivalent, kept as
reference.

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
supabase functions deploy send-capture-reminders --no-verify-jwt
supabase functions deploy purge-used-clips --no-verify-jwt
supabase functions deploy fulfill-data-export --no-verify-jwt
supabase functions deploy get-export-url
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

### Server push scheduling (one-time setup after the first deploy)

Local notifications (scheduled by the app itself) are the primary
reminder delivery path and work with zero server setup. The
`send-capture-reminders` function is a *backup* path for when a reminder
was scheduled but the app was killed/reinstalled before it could fire —
it reads the same `capture_slots` rows the client already writes, so it
never recomputes (and risks drifting from) the timezone/DST-aware
schedule logic. To enable it:

1. In the Supabase dashboard → Database → Extensions, enable `pg_cron`
   and `pg_net` (both ship with every project, just not enabled by
   default).
2. Run once, in the SQL editor, with your real project ref and a service
   role key (or better, a key scoped only to invoke this function if your
   plan supports it):
   ```sql
   select cron.schedule(
     'send-capture-reminders',
     '*/5 * * * *',
     $$
     select net.http_post(
       url := 'https://<your-project-ref>.supabase.co/functions/v1/send-capture-reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
       body := '{}'::jsonb
     );
     $$
   );
   ```
   (`<CRON_SECRET>` must match the `CRON_SECRET` value set in the
   function's own secrets — see `supabase/functions/.env.example`.)
3. That's it — the function is idempotent (`capture_slots.notified_at`)
   and self-limiting (a 15-minute stale window, so a cron outage doesn't
   produce a backlog of late pushes), so there's no further maintenance.

Without this setup, the app still works correctly — reminders just rely
solely on the local-notification path, same as before this was added.

### Raw-clip storage purge scheduling (recommended before real usage)

`purge-used-clips` frees the storage cost of raw clips once they've done
their job (see `docs/COSTS.md`'s "expire raw clips after rendering"
lever) — it removes the storage object for clips the render worker
already marked `status = 'used'`, past `RAW_CLIP_RETENTION_DAYS` (default
7). The database row and `montage_clips` history are kept either way,
just the video bytes are freed. Same `pg_cron` mechanism as above, run
once daily is plenty:

```sql
select cron.schedule(
  'purge-used-clips',
  '0 4 * * *',   -- once daily at 4am UTC
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/purge-used-clips',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

Without this, raw clips simply accumulate in storage indefinitely until
the user deletes them individually or deletes their account — functional,
just more expensive at scale than necessary.

### Data-export fulfillment scheduling (recommended before real usage)

`fulfill-data-export` compiles a requester's profile/clips-metadata/
montages/activity into JSON and uploads it to the private `exports`
bucket (see `docs/PRIVACY_DATA_FLOW.md`); `get-export-url` (deployed with
normal JWT verification, unlike the other three cron-invoked functions
here) is how the app retrieves a short-lived signed URL to download it —
no email-sending infrastructure needed. Same `pg_cron` mechanism, run
every few minutes is plenty since requests are rare:

```sql
select cron.schedule(
  'fulfill-data-export',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/fulfill-data-export',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

Without this, a requested export stays `pending` forever (the request is
still recorded — genuinely auditable, just never fulfilled) until someone
manually invokes the function once. There's no way to compile the export
some other way without this scheduling — unlike the other two backup
paths above, this one has no local fallback.

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
8. (Optional) Set `EXPO_PUBLIC_SENTRY_DSN` for the production build
   profile to turn on crash reporting (`mobile/src/lib/crashReporting.ts`
   is a real no-op without it — see `docs/OWNER_ACTIONS_REQUIRED.md`).
   For readable (non-minified) stack traces, also set `SENTRY_ORG`,
   `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` as EAS build secrets so the
   `@sentry/react-native/expo` config plugin can upload source maps
   during the build.

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
- **Mobile**: Sentry crash reporting is wired in
  (`mobile/src/lib/crashReporting.ts`) but off until `EXPO_PUBLIC_SENTRY_DSN`
  is set — see step 8 above and `docs/OWNER_ACTIONS_REQUIRED.md`.

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
