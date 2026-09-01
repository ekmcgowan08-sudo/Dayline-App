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
defense-in-depth input length validation, Sentry crash-reporting
scaffolding (off by default, real no-op without a DSN), automated
data-export fulfillment (`fulfill-data-export`/`get-export-url` — no
manual operator step, no email infrastructure needed), a real
"Your Day Is Ready" push the moment a personal montage finishes
rendering (with tap-to-open deep linking and its own opt-out toggle),
and CI actually wired up + running (it existed since early in the build
but had never once triggered — see `docs/DECISIONS.md`), plus three
`workflow_dispatch` GitHub Actions workflows that turn Actions into a
one-click deploy path for Supabase, EAS builds, and Sentry verification
once account credentials exist. Also since added: the same "day is
ready" push extended to group montages (everyone but the requester,
per `docs/DECISIONS.md`), a real calendar/grid view for Memories
(month grid with personal/group indicator dots, tap a day to filter the
list to it) alongside the original chronological list, real
poster-frame thumbnails everywhere a montage is listed — reusing the
on-device pattern `ClipThumbnail` already established rather than the
worker/storage build-out originally sketched for it (see
`docs/DECISIONS.md`) — and, closing out Milestone 4, owner-gated group
admin promotion/demotion plus ownership transfer (which turned out to be
a missing capability, not just a missing UI, and fixed a related dead
end: an owner previously had no way to leave a group with other members
still in it). Also since added: rate limiting on comment and reaction
inserts (the last two user-generated-content paths that had none), via
the same `check_rate_limit()` bucket already used everywhere else in
this schema, added straight into their existing RLS `WITH CHECK`
policies with no client-code change needed, plus the same for group
creation (5/hour per user) once found to be the last unrestricted
group-membership write path. See `docs/IMPLEMENTATION_STATUS.md` for
the exact, honest verification tier on every piece.

## Milestone 2 — Production hardening

- Run this build's Edge Functions and worker against a real Supabase
  project end-to-end — the one gap this development sandbox genuinely
  couldn't close directly (its egress policy denies supabase.com), now
  covered by `deploy-supabase.yml` (see "The fast path" in
  `docs/OWNER_ACTIONS_REQUIRED.md`) once an owner provides account
  credentials. This includes actually enabling `pg_cron`/`pg_net` and
  scheduling `send-capture-reminders`/`purge-used-clips`/
  `fulfill-data-export` per `docs/DEPLOYMENT.md` — all three functions
  exist and are tested in isolation, but the scheduling itself needs a
  real project (no CLI/API equivalent, has to be a one-time dashboard
  SQL-editor step).
- Replace placeholder icon/splash assets with real Dayline branding (see
  `docs/ASSET_LICENSES.md`).

## Milestone 3 — Reveal & memories polish

- Tune the 7/30/365-day "On This Day" cadence based on real retention data.

## Milestone 4 — Groups at scale ✅

Admin promotion/demotion and ownership transfer, both owner-gated —
closed in full, including a related gap found while building it (an
owner had no way to leave a group with other members still in it short
of deleting it for everyone). See `docs/DECISIONS.md`. No further items
identified for this milestone; add here if real usage surfaces one.

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
