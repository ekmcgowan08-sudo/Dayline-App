# Launch Checklist

Not legal advice — have a lawyer review anything user-facing before
public launch. This checklist separates what's genuinely done in this
repo from what's an owner action; see `docs/OWNER_ACTIONS_REQUIRED.md`
for the consolidated version of the latter.

## Legal & policy (drafts exist, none reviewed by counsel)

- [x] Privacy Policy draft — `PRIVACY.md`
- [x] Terms of Service draft — `TERMS.md`
- [x] Community Guidelines draft — `COMMUNITY_RULES.md`
- [x] Copyright/DMCA process draft — `docs/LEGAL_DRAFTS.md`
- [x] Data deletion policy draft — `docs/LEGAL_DRAFTS.md` + `docs/PRIVACY_DATA_FLOW.md`
- [x] Subscription disclosures draft — `docs/LEGAL_DRAFTS.md`
- [x] App Store privacy "nutrition label" draft — `docs/LEGAL_DRAFTS.md`
- [x] Google Play Data Safety form draft — `docs/LEGAL_DRAFTS.md`
- [x] Minimum-age policy (13+) + COPPA analysis draft — `docs/LEGAL_DRAFTS.md`
- [ ] **Owner action**: actual legal review of all of the above
- [ ] **Owner action**: trademark/domain clearance (`docs/STORE_SUBMISSION.md` checklist)

## Technical

- [x] Real (not soft-hide) account deletion — `docs/SECURITY.md`
- [x] RLS on every user-data table, with automated proofs —
      `supabase/tests/rls_security.test.sql`
- [x] Signed URLs only, never public buckets — proven, not just claimed
- [x] Reporting/blocking implemented and RLS-enforced
- [x] Rate limiting on every user-generated-content write path (invite-code
      redemption, reports, montage requests, account deletion,
      transcription, comments, reactions, group creation) plus sensitive
      Edge Functions
- [x] CI configured and actually running on real GitHub infrastructure —
      `.github/workflows/ci.yml`, confirmed job-by-job on 14+ consecutive
      clean runs (see `docs/IMPLEMENTATION_STATUS.md`)
- [ ] **Owner action**: a real Supabase project provisioned and this
      repo's migrations/functions/worker actually run against it
      end-to-end — `deploy-supabase.yml` (GitHub Actions) automates the
      run once credentials exist, see `docs/OWNER_ACTIONS_REQUIRED.md`
- [ ] **Owner action**: production secrets set (service role key, RevenueCat
      keys, OpenAI key if AI captions are enabled)
- [ ] Real Dayline app icon/splash (currently Expo template placeholders —
      `docs/ASSET_LICENSES.md`)
- [x] Crash reporting scaffolding wired in (Sentry, off by default, real
      no-op without a DSN) — `mobile/src/lib/crashReporting.ts`;
      `verify-sentry.yml` (GitHub Actions) confirms the real round-trip
      once a DSN exists

## Store readiness

- [x] App Store / Google Play copy drafts — `docs/STORE_SUBMISSION.md`
- [x] Screenshot shot list + app preview storyboard drafted
- [ ] **Owner action**: Apple Developer Program enrollment ($99/yr)
- [ ] **Owner action**: Google Play Developer account ($25 one-time)
- [ ] **Owner action**: actual screenshots/preview video captured from a
      real running app on a real/simulated device
- [ ] **Owner action**: App Store Connect / Play Console privacy
      questionnaires filled in using the drafts above as a starting point

## Moderation

- [x] Report/block data model + RLS enforcement
- [x] Moderation runbook for the beta's expected volume — `docs/MODERATION_RUNBOOK.md`
- [ ] Admin dashboard (deferred by design for the private beta — direct
      service-role SQL is the documented interim process)

## Launch path

Development build → internal testing (Expo Go / TestFlight internal) →
TestFlight / Android closed testing → invite-only beta → single-campus
pilot (see `docs/STORE_SUBMISSION.md`'s ambassador plan draft) → public
release.

**Do not treat any unchecked item above as "will figure it out later" —
each one is either already done in this repo or requires the owner
specifically, consolidated in `docs/OWNER_ACTIONS_REQUIRED.md`.**
