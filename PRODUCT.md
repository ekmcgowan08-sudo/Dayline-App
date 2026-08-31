# Product

**Positioning:** "Don't perform your life. Remember it." A private
micro-vlogging app built around close friend groups, not followers.

**Core loop:** Notification → 5-second capture → repeat through the day →
automatic daily montage → "Your Day Is Ready" reveal → optionally shared
as "Our Day" with a friend group → resurfaces later as a Memory.

**Alternate taglines to test:**
- "Live it. Watch it back."
- "The daily movie of your actual life."
- "Five seconds at a time."
- "Not a feed. A film."

**Name candidates** (unverified for trademark/domain availability — see
`docs/STORE_SUBMISSION.md`'s clearance checklist before committing):
Dayline, Fivesec, Realframe, Momently, Ourday, Daykeep, Loopdiary,
Candidly, Smallmoments, Dayreel, Trueframe, Ordinaryco, Nowclip, Daymark,
Everdayapp, Realish, Justtoday, Groupreel, Daybook, Fivesecondlife.

**Recommended working name for development:** Dayline (short, easy to
say, "line" evokes a timeline of a day). Centralized in
`mobile/src/constants/brand.ts` for a one-file rename if clearance fails.

## Feature areas (all implemented — see `docs/IMPLEMENTATION_STATUS.md` for verification tier on each)

1. **Onboarding & auth** — purpose explainer, consent (age/terms/privacy/
   rules, each an audited acceptance record), email/password auth with
   session persistence, profile setup.
2. **Capture scheduling** — active days, three frequency modes
   (randomized/hourly/custom exact times), quiet hours, pause, timezone/
   DST-aware, local notifications + a durable `capture_slots` record.
3. **Five-second capture** — front/rear camera, countdown, retake/use
   review, offline-first idempotent upload queue with backoff retry.
4. **Today timeline** — per-slot completed/missed/upcoming states, no
   shame-based language, no public metrics of any kind.
5. **Personal daily montage** — real ffmpeg rendering (portrait 9:16,
   normalized, title card, fades), reveal experience, save/share.
6. **Groups & "Our Day"** — 6-character crypto-strong invite codes, atomic
   race-free 10-member cap, roles (owner/admin/member), explicit
   per-clip opt-in sharing (never implicit from membership), group
   montage rendering.
7. **Reactions, comments, moderation** — a restrained 6-emoji reaction
   set, comments with author/moderator delete, reports, blocking (RLS-
   enforced, not just client-side filtering).
8. **Memories** — On This Day (7/30/365 days), personal + group archive
   with date/group search, personal-montage deletion.
9. **Subscriptions** — RevenueCat-backed free/Plus entitlement model, a
   working feature-gate example (group count limit, fails safe), a
   clearly-marked dev-only mock purchase path when no real keys exist.
10. **Optional AI captions** — off by default, per-clip opt-in consent,
    provider abstraction, mock adapter exercised end-to-end, no training
    on user content.
11. **Settings & account controls** — profile, schedule, memory
    notifications, blocked-people management, legal document viewer,
    data export request, real (not soft-hide) account deletion.

## Product decisions worth calling out

- **First-run schedule default**: 8:00 AM–11:00 PM, randomized, ~8
  reminders/day — inherited from the recovered prototype's own PRD
  example, kept because it's a sensible default and fully editable.
- **Group cap is 10, hard limit**: enforced atomically at the database
  layer (`docs/SECURITY.md`), not just a UI suggestion.
- **No shame-based language anywhere**: a missed capture slot is labeled
  "Missed," never framed as a streak break or failure.
- **No public engagement metrics, anywhere in the product** — not on
  personal montages, not on group montages, not on comments/reactions.
  This is a hard product constraint reflected in the schema itself (no
  aggregate "like count" surfaced to end users beyond a private per-viewer
  reaction toggle).

## Explicitly out of scope for this build

- Facial recognition or any content-profiling for memory resurfacing —
  "On This Day" is pure date arithmetic over the user's own montages.
- Public discovery, hashtags, or any cross-user content surface.
- In-feed advertising.
