# Roadmap

## Milestone 1 — Vertical slice ✅ (this build)

Auth, onboarding, capture scheduling, 5-second capture, offline-first
upload, Today timeline, real ffmpeg-rendered personal montages, groups
with atomic invite/cap/rate-limit enforcement, "Our Day" group montages,
reactions/comments/reports/blocks, memories, settings, real account
deletion, subscription entitlement plumbing (mock + live-ready),
consent-gated AI captions, RLS security test suite, CI configuration.
Also since folded into Milestone 1 rather than left for later milestones:
server-side backup push delivery for capture reminders, raw-clip storage
lifecycle (mark-used + scheduled purge), server-enforced (not just
documented) free-tier memory archive limits, an entitlement-gated Dayline
end card, a tasteful on-video contributor-credits card for group
montages, per-group timezone for group-montage day boundaries,
defense-in-depth input length validation, and Sentry crash-reporting
scaffolding (off by default, real no-op without a DSN). See
`docs/IMPLEMENTATION_STATUS.md` for the exact, honest verification tier
on every piece.

## Milestone 2 — Production hardening

- Run this build's Edge Functions and worker against a real Supabase
  project end-to-end (the one gap this development sandbox genuinely
  couldn't close — no Docker daemon, no live project). This includes
  actually enabling `pg_cron`/`pg_net` and scheduling
  `send-capture-reminders`/`purge-used-clips` per `docs/DEPLOYMENT.md` —
  both functions exist and are tested in isolation, but the scheduling
  itself needs a real project.
- Replace placeholder icon/splash assets with real Dayline branding (see
  `docs/ASSET_LICENSES.md`).
- Automated data-export fulfillment (currently a manual runbook step —
  see `docs/PRIVACY_DATA_FLOW.md`).

## Milestone 3 — Reveal & memories polish

- Push notification for "Your Day Is Ready" specifically (currently the
  reveal is pull-based — the user opens the app and sees it).
- Richer Memories calendar/grid view beyond the current chronological
  list + search.
- Tune the 7/30/365-day "On This Day" cadence based on real retention data.

## Milestone 4 — Groups at scale

- Admin-role UI refinements (currently owner/admin have identical
  permissions in the app; the schema already distinguishes them for
  future differentiation).

## Milestone 5 — Monetization

- Confirm real product IDs in App Store Connect / Play Console, wire real
  RevenueCat API keys (currently mock-mode by default — see
  `docs/DECISIONS.md`).
- Verify `revenuecat-webhook`'s payload shape against live RevenueCat
  docs/a real sandbox purchase (written from a web-search summary in this
  session, not confirmed live — see `docs/SECURITY.md`).
- A/B test free-tier limits (`ENTITLEMENT_LIMITS` is deliberately
  centralized and easy to tune).

## Milestone 6 — Campus launch

- Execute the trademark/domain clearance checklist in
  `docs/STORE_SUBMISSION.md` before any public-facing launch.
- Ambassador/referral tracking analytics (invite-code infrastructure
  already supports per-group attribution; dedicated funnel events are new
  work).
- Legal review of `TERMS.md`/`PRIVACY.md`/`COMMUNITY_RULES.md`/
  `docs/LEGAL_DRAFTS.md` — all currently editable drafts, not reviewed by
  counsel (see `docs/OWNER_ACTIONS_REQUIRED.md`).
- Content moderation scale-up: automated content scanning if/when open
  signup (vs. invite-only beta) is considered — see
  `docs/MODERATION_RUNBOOK.md`'s explicit note on this.
