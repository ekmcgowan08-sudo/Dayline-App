# Owner Actions Required

Everything in this repository that could be built, run, and verified
without a human's identity, payment, legal judgment, or account
credentials has been done — see `docs/IMPLEMENTATION_STATUS.md` for the
full, honest accounting. This document consolidates every remaining item
that genuinely needs you (or a differently-provisioned environment), so
you only have to read one list.

## Accounts & credentials (nondelegable)

1. **Create a production Supabase project** (supabase.com — needs your
   account/billing). Then:
   - `supabase link --project-ref <ref> && supabase db push` to apply
     every migration in `supabase/migrations/`.
   - Deploy the 5 Edge Functions in `supabase/functions/` (commands in
     `README.md`/`docs/DEPLOYMENT.md`).
   - Set secrets via `supabase secrets set --env-file supabase/functions/.env`
     (fill in real values first — see `supabase/functions/.env.example`).
   - Fill in `mobile/.env` and `worker/.env` with the real project URL,
     anon key, and service role key.
2. **Apple Developer Program** ($99/yr) — needed for TestFlight/App Store.
3. **Google Play Developer account** ($25 one-time) — needed for Play
   Store internal testing/release.
4. **RevenueCat account** (free up to $2,500 MTR — see `COSTS.md`) —
   create products in App Store Connect / Play Console, mirror them in
   RevenueCat, set the `plus` entitlement identifier to match
   `REVENUECAT_ENTITLEMENT_ID` in `mobile/src/constants/entitlements.ts`,
   configure the webhook pointing at your deployed `revenuecat-webhook`
   function with a shared secret matching `REVENUECAT_WEBHOOK_SECRET`.
   Until you do this, the app runs correctly on a clearly-labeled local
   mock purchase adapter — see `docs/DECISIONS.md`.
5. **Expo/EAS account** — run `eas init` from `mobile/` to get a real EAS
   project ID and replace the placeholder in `mobile/app.json`'s
   `extra.eas.projectId` (currently `REPLACE_WITH_REAL_EAS_PROJECT_ID`,
   which will fail if left as-is when building).
6. **(Optional) OpenAI API key** — only needed if you want to enable the
   real (non-mock) AI captions provider; set `OPENAI_API_KEY` and
   `TRANSCRIPTION_PROVIDER=openai` in the `transcribe` function's secrets.
   The feature works and is fully testable without this (mock adapter).
7. **Render worker hosting** — pick a Docker-capable host (see `COSTS.md`
   for a few current options and prices) and provision an account/billing
   there; point its env vars at your Supabase project's service role key.

## Legal & business judgment (nondelegable)

8. **Legal review** of `TERMS.md`, `PRIVACY.md`, `COMMUNITY_RULES.md`, and
   `docs/LEGAL_DRAFTS.md` (DMCA process, subscription disclosures, App
   Store/Play privacy disclosures, minimum-age/COPPA analysis). All are
   working drafts, explicitly labeled as not legal advice throughout.
9. **Confirm the 13+ minimum age default** is right for your actual
   target audience — this was the task's own instructed default absent
   other evidence, not a business decision made on your behalf.
10. **DMCA agent registration** (U.S. Copyright Office or equivalent) if
    operating in/serving jurisdictions where this applies.
11. **Trademark/domain clearance for "Dayline"** — run the checklist in
    `docs/STORE_SUBMISSION.md`. The name is centralized in
    `mobile/src/constants/brand.ts` for a one-file rename if needed.
12. **A real, monitored support inbox** — `support@dayline.app` is used
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

13. **A Docker-capable environment**: build/run `worker/Dockerfile`, and
    run a real `supabase start` local stack to confirm this repo's
    migrations apply cleanly through the genuine Supabase CLI (they're
    already proven against real Postgres semantics — this is about the
    Supabase-specific platform layer around it, not the SQL itself).
14. **A macOS environment with Xcode / an Android emulator**: exercise
    the actual camera/microphone capture flow, push notification
    registration on a real device, and produce real App Store/Play Store
    screenshots (the shot list is drafted in `docs/STORE_SUBMISSION.md`,
    nothing has been captured).
15. **Network access to revenuecat.com**: confirm the `revenuecat-webhook`
    function's payload field names and auth-header convention against
    RevenueCat's current live docs (written from a web-search summary in
    this session — flagged explicitly in the function's own comments,
    see `docs/DECISIONS.md`).
16. **Network access to GitHub Actions**: confirm `.github/workflows/ci.yml`
    actually runs green on real infrastructure (only YAML-syntax-validated
    in this session).

## Not required, but worth knowing about

- Placeholder app icon/splash images (Expo template defaults) — see
  `docs/ASSET_LICENSES.md`. Cosmetic, not blocking, but should change
  before any store submission.
- Crash reporting (e.g., Sentry) isn't wired in — recommended before
  public launch, not required for the beta.
- Automated data-export fulfillment doesn't exist yet — requests are
  genuinely recorded; compiling and sending the archive is a manual
  runbook step for now (`docs/PRIVACY_DATA_FLOW.md`).

---

Nothing above should be interpreted as "the app doesn't work without it."
The full vertical slice — auth through account deletion — is implemented
and, wherever this environment allowed, actually tested. This list is
what's left specifically because it requires you.
