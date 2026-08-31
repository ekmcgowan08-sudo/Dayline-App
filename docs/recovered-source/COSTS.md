# Cost estimate (rough, treat as hypotheses)

Assumes Supabase (Postgres + Storage + Auth + Edge Functions), a small ffmpeg worker, and Expo push notifications.

| Users | Supabase plan | Storage/bandwidth | Rendering worker | Est. monthly cost |
|---|---|---|---|---|
| 100 | Free tier | Free tier (1GB storage, 2GB egress) sufficient | Free-tier container (Fly.io) | $0-10 |
| 1,000 | Supabase Pro ($25/mo) | ~10-20GB video/month, likely still under Pro allowances | Small always-on container, ~$5-10/mo | ~$35-50 |
| 10,000 | Supabase Pro + storage add-ons | Video storage/egress becomes the dominant cost; expect $150-400/mo depending on retention policy and montage length | Autoscaled worker fleet, $50-150/mo | ~$300-600 |
| 100,000 | Custom/enterprise Postgres + dedicated object storage (e.g. Cloudflare R2 for egress-free storage) | Likely the largest line item; strongly consider R2 or Backblaze B2 to avoid egress fees | Managed rendering pipeline (AWS MediaConvert or a worker fleet) | $2,000-6,000+/mo, highly dependent on retention/deletion policy |

Key levers to control cost as you scale:
- Aggressively expire/compress raw clips after the montage is rendered; keep only the finished montage long-term.
- Cap free-tier history length (spec section 6/13) so storage growth is bounded per free user.
- Use Cloudflare R2 or Backblaze B2 for storage once egress fees start mattering - both are S3-compatible and dramatically cheaper for outbound video bandwidth than most providers.
- Transcription/AI summaries are optional per spec - keep them Plus-tier only so free-tier AI costs stay near zero.

These numbers are directional planning estimates, not quotes. Verify current pricing on each provider's site before budgeting.
