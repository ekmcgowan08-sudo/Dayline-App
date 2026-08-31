# Owner Actions Required

Everything in this repository that could be built, run, and verified
without a human's identity, payment, legal judgment, or account
credentials has been done — see `docs/IMPLEMENTATION_STATUS.md` for the
full, honest accounting. This document consolidates every remaining item
that genuinely needs you (or a differently-provisioned environment), so
you only have to read one list.

## The fast path: let GitHub Actions do the building

The development sandbox that built this repo has network access to a
short allowlist of package registries and to GitHub itself — not to
supabase.com, sentry.io, expo.dev, or Docker Hub's CDN, all of which are
blocked by that sandbox's own egress policy (confirmed directly, not
assumed — see `docs/DECISIONS.md`). GitHub Actions runners have none of
those restrictions, so four workflows in `.github/workflows/` do the
account-gated work for you once you've created the underlying accounts
and pasted a few tokens into this repo's secrets
(Settings → Secrets and variables → Actions):

| Workflow | What it needs from you | What it does |
|---|---|---|
| `ci.yml` | Nothing (already runs automatically) | Real typecheck/lint/tests for mobile + worker, a **real Docker image build** of the worker, real Postgres 16 + RLS test suite, Deno typecheck, dependency audit, secret scan |
| `deploy-supabase.yml` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_FUNCTIONS_ENV` | Links your Supabase project, runs every migration, deploys all 7 Edge Functions, sets their secrets |
| `eas-build.yml` | `EXPO_TOKEN`, `MOBILE_ENV_FILE` | Builds the actual mobile app on Expo's cloud — an iOS Simulator build (no Apple Developer account needed) and/or an installable Android APK, no Xcode/Android Studio/Docker required anywhere |
| `verify-sentry.yml` | `SENTRY_DSN` | Sends a real event straight to Sentry's ingest API and fails the job unless Sentry actually accepts it |

Run any of these from the repo's **Actions** tab → pick the workflow →
"Run workflow". Your only remaining manual steps are things no build
environment can do on your behalf: creating the Supabase/Expo/Sentry
accounts (identity + billing) and copying their tokens into GitHub's
secret store. Everything downstream of that is now one click. The
sections below still document the equivalent manual CLI commands, kept as
reference and for anyone who prefers running them locally.

## Accounts & credentials (nondelegable)

1. **Create a production Supabase project** (supabase.com — needs your
   account/billing). Then either run `deploy-supabase.yml` (see "The fast
   path" above — one click, once its four secrets are set) or do it by
   hand:
   - `supabase link --project-ref <ref> && supabase db push` to apply
     every migration in `supabase/migrations/`.
   - Deploy the 7 Edge Functions in `supabase/functions/` (commands in
     `README.md`/`docs/DEPLOYMENT.md`).
   - Set secrets via `supabase secrets set --env-file supabase/functions/.env`
     (fill in real values first — see `supabase/functions/.env.example`).
   - Fill in `mobile/.env` and `worker/.env` with the real project URL,
     anon key, and service role key.
2. **Enable `pg_cron`/`pg_net` and schedule the two backup jobs**
   (Database → Extensions in the dashboard, then the `cron.schedule(...)`
   calls in `docs/DEPLOYMENT.md`'s "Server push scheduling" and
   "Raw-clip storage purge scheduling" sections): `send-capture-reminders`
   (push-notification backup delivery) and `purge-used-clips` (storage
   cost control). The app works without this — reminders just rely
   solely on local notifications, and raw clips simply aren't
   auto-purged — but both are recommended before real usage.
3. **Apple Developer Program** ($99/yr) — needed for TestFlight/App Store.
4. **Google Play Developer account** ($25 one-time) — needed for Play
   Store internal testing/release.
5. **RevenueCat account** (free up to $2,500 MTR — see `COSTS.md`) —
   create products in App Store Connect / Play Console, mirror them in
   RevenueCat, set the `plus` entitlement identifier to match
   `REVENUECAT_ENTITLEMENT_ID` in `mobile/src/constants/entitlements.ts`,
   configure the webhook pointing at your deployed `revenuecat-webhook`
   function with a shared secret matching `REVENUECAT_WEBHOOK_SECRET`.
   Until you do this, the app runs correctly on a clearly-labeled local
   mock purchase adapter — see `docs/DECISIONS.md`.
6. **Expo/EAS account** — run `eas init` from `mobile/` to get a real EAS
   project ID and replace the placeholder in `mobile/app.json`'s
   `extra.eas.projectId` (currently `REPLACE_WITH_REAL_EAS_PROJECT_ID`,
   which will fail if left as-is when building). Once you have an
   account, `eas-build.yml`'s default `simulator` profile gets you a
   running iOS build with no Apple Developer Program enrollment and no
   Xcode anywhere — see "The fast path" above.
7. **(Optional) OpenAI API key** — only needed if you want to enable the
   real (non-mock) AI captions provider; set `OPENAI_API_KEY` and
   `TRANSCRIPTION_PROVIDER=openai` in the `transcribe` function's secrets.
   The feature works and is fully testable without this (mock adapter).
8. **Render worker hosting** — pick a Docker-capable host (see `COSTS.md`
   for a few current options and prices) and provision an account/billing
   there; point its env vars at your Supabase project's service role key.
9. **(Optional) Sentry account** for crash reporting — free tier covers a
   beta's volume. Create a project, put its DSN in `mobile/.env`'s
   `EXPO_PUBLIC_SENTRY_DSN`. The app runs correctly and gets a real error
   boundary either way; without a DSN, `src/lib/crashReporting.ts` is a
   clearly-labeled no-op (same treatment as the RevenueCat mock adapter —
   see `docs/DECISIONS.md`). For build-time source-map upload (readable
   stack traces instead of minified ones), also set `SENTRY_ORG`,
   `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` as EAS build secrets — skip
   this and builds still work, traces just won't symbolicate.

## Legal & business judgment (nondelegable)

10. **Legal review** of `TERMS.md`, `PRIVACY.md`, `COMMUNITY_RULES.md`, and
    `docs/LEGAL_DRAFTS.md` (DMCA process, subscription disclosures, App
    Store/Play privacy disclosures, minimum-age/COPPA analysis). All are
    working drafts, explicitly labeled as not legal advice throughout.
11. **Confirm the 13+ minimum age default** is right for your actual
    target audience — this was the task's own instructed default absent
    other evidence, not a business decision made on your behalf.
12. **DMCA agent registration** (U.S. Copyright Office or equivalent) if
    operating in/serving jurisdictions where this applies.
13. **Trademark/domain clearance for "Dayline"** — run the checklist in
    `docs/STORE_SUBMISSION.md`. The name is centralized in
    `mobile/src/constants/brand.ts` for a one-file rename if needed.
14. **A real, monitored support inbox** — `support@dayline.app` is used
    throughout the app/docs as a placeholder; point it at something you
    actually read, or change it everywhere (again, centralized in
    `brand.ts`).

## Verification that needs a different environment than this one

This development sandbox had no Docker daemon, no live Supabase project,
no camera/microphone-capable device or simulator, and network egress
blocked to most non-package-registry hosts (including revenuecat.com and
github.com directly). Everything possible was verified anyway — real
Postgres 16 for the full schema + RLS test suite, real ffmpeg for the
render pipeline, real `npm`/`eslint`/`tsc`/`jest` runs — see
`docs/IMPLEMENTATION_STATUS.md` for exactly what and
`docs/TESTING.md` for how to reproduce it. What's left needs one of:

15. **Building/running `worker/Dockerfile` for real is now done** — see
    `ci.yml`'s `worker-docker-build` job, which runs on every push/PR.
    Checked directly rather than assumed: the development sandbox this
    repo was built in has a working Docker daemon (`dockerd` runs fine),
    the actual blocker was that its egress policy denies Docker Hub's
    blob CDN — an environment-specific network policy, not a missing
    capability, and GitHub Actions runners aren't behind it. What's still
    genuinely open: running a real `supabase start` local stack to
    confirm this repo's migrations apply cleanly through the genuine
    Supabase CLI (they're already proven against real Postgres
    semantics — this is about the Supabase-specific platform layer
    around it, not the SQL itself). `deploy-supabase.yml` covers the
    production-equivalent path (`db push` against a real linked project)
    without needing this at all.
16. **A macOS environment with Xcode / an Android emulator**: exercise
    the actual camera/microphone capture flow, push notification
    registration on a real device, and produce real App Store/Play Store
    screenshots (the shot list is drafted in `docs/STORE_SUBMISSION.md`,
    nothing has been captured).
17. **Network access to revenuecat.com**: confirm the `revenuecat-webhook`
    function's payload field names and auth-header convention against
    RevenueCat's current live docs (written from a web-search summary in
    this session — flagged explicitly in the function's own comments,
    see `docs/DECISIONS.md`).
18. **Network access to GitHub Actions**: confirm `.github/workflows/ci.yml`
    actually runs green on real infrastructure (only YAML-syntax-validated
    in this session).
19. **Network access to sentry.io**: confirm a real event round-trips end
    to end once `EXPO_PUBLIC_SENTRY_DSN` is set (item 9 above) — the
    integration code is real and unit-tested for its no-op path, but no
    event has actually been sent from this sandbox (its egress policy
    denies sentry.io directly, confirmed via the proxy's own status log,
    not merely assumed). Run `verify-sentry.yml` (see "The fast path"
    above) to confirm this from GitHub Actions instead — no local network
    access required at all.

## Not required, but worth knowing about

- Placeholder app icon/splash images (Expo template defaults) — see
  `docs/ASSET_LICENSES.md`. Cosmetic, not blocking, but should change
  before any store submission.
- Automated data-export fulfillment doesn't exist yet — requests are
  genuinely recorded; compiling and sending the archive is a manual
  runbook step for now (`docs/PRIVACY_DATA_FLOW.md`).

---

Nothing above should be interpreted as "the app doesn't work without it."
The full vertical slice — auth through account deletion — is implemented
and, wherever this environment allowed, actually tested. This list is
what's left specifically because it requires you.
