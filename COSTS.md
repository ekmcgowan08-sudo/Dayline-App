# Cost Estimates

**These are directional planning estimates, not quotes.** Every number
below is dated and sourced; vendor pricing changes often — re-verify on
each vendor's live pricing page before budgeting real money. Nothing here
is a guarantee, and no purchase has been made on the project's behalf.

Sources (retrieved 2026-08-31 via web search; verify against live pages
before relying on these):
- [Supabase pricing overview — jetadmin.io](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/) and [makerkit.dev](https://makerkit.dev/blog/saas/supabase-pricing)
- [Render vs Railway vs Fly.io pricing — dev.to](https://dev.to/pavel-hostim/render-vs-railway-vs-flyio-pricing-compared-2026-2e5p) (accurate as of June 2026 per the source itself)
- [RevenueCat pricing — costbench.com](https://costbench.com/software/subscription-billing/revenuecat/)

## Assumptions

- Video-heavy product: the dominant cost driver at any real scale is
  storage + egress for clips and montages, not compute or database rows.
- Render worker is a single small always-on container (or scaled
  horizontally — the job-claim design in `docs/SECURITY.md` supports
  multiple replicas safely).
- No paid AI transcription usage assumed (feature is off by default;
  add OpenAI/Whisper API costs separately if enabled — not estimated here
  since no production credentials or usage baseline exist yet).

## Development (free tier, this repo's current state)

| Item | Cost |
|---|---|
| Supabase free tier (2 projects, 500MB DB, 1GB storage, 5GB egress, 50K MAU) | $0/mo |
| Render worker on a free/near-free tier (or run locally) | $0–2/mo |
| RevenueCat (free up to $2,500 MRR tracked) | $0/mo |
| Apple Developer Program | $99/yr (one-time enrollment, recurring annually) |
| Google Play Developer account | $25 one-time |
| **Total to develop + internally test** | **~$0–2/mo + $99/yr + $25 one-time** |

## Private beta (dozens to low hundreds of users)

| Item | Estimate | Notes |
|---|---|---|
| Supabase | $0–25/mo | Free tier likely sufficient below ~50 active users given generous MAU/storage limits; Supabase Pro ($25/mo base) once storage/egress/MAU limits are approached |
| Render worker | $5–20/mo | A single small container (Fly.io ~$2–8/mo for a minimal always-on machine, Render Starter ~$7/mo, Railway Hobby ~$5/mo base + usage) |
| RevenueCat | $0/mo | Under the $2,500 MTR free threshold at this scale |
| **Total** | **~$5–45/mo** | Plus the one-time/annual developer account fees above |

## Growth (thousands of users)

| Item | Estimate | Notes |
|---|---|---|
| Supabase Pro + overages | $25–150/mo | Storage/egress become the dominant variable — video is heavy; aggressively expiring/compressing raw clips after rendering (keeping only finished montages long-term) is the single biggest lever here |
| Render worker | $20–60/mo | Likely 1–2 replicas; the job-claim design already supports horizontal scaling without code changes |
| RevenueCat | ~1% of tracked revenue above $2,500 MTR | Scales with actual subscription revenue, not user count |
| **Total** | **~$50–200+/mo**, highly dependent on retention/deletion policy and paid conversion | |

## Key cost-control levers

- **Expire raw clips after rendering** — implemented: the render worker
  marks a clip `used` once it's in its owner's own personal montage, and
  a scheduled `purge-used-clips` function frees the storage object (not
  the row) after `RAW_CLIP_RETENTION_DAYS` (default 7). Needs the
  `pg_cron` scheduling step in `docs/DEPLOYMENT.md` to actually run on a
  real project. Video *compression* beyond the worker's existing
  normalization pass (already re-encodes to a consistent bitrate/codec)
  is still a documented future lever, not implemented.
- **Cap free-tier memory/history length** — implemented and
  server-enforced (not just a documented hypothesis): `list_my_personal_
  montages()`/`list_my_group_montages()` RPCs actually filter by
  `ENTITLEMENT_LIMITS.free.memoryArchiveDays` (`mobile/src/constants/
  entitlements.ts`, 30 days) — proven in
  `supabase/tests/entitlement_archive.test.sql`.
- **Consider S3-compatible egress-free storage** (Cloudflare R2, Backblaze
  B2) once video egress costs start mattering — both are commonly used
  alongside Supabase for exactly this reason. Not integrated in this
  build; Supabase Storage is used throughout for simplicity at this stage.
- **AI captions stay optional and off by default** — keeps that cost at
  effectively zero until/unless explicitly enabled and used.
