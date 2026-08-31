# Store Submission & Launch Materials

Working drafts. "Dayline" is a working name pending trademark/domain
clearance (see the checklist at the bottom) — everything here uses it,
but nothing here constitutes trademark clearance or store approval.

## App Store (iOS)

**Name:** Dayline
**Subtitle** (30 char limit): Five seconds. Every day.
**Promotional text** (170 char, editable anytime):
> Don't perform your life. Remember it. Dayline turns a few five-second
> moments a day into one private film — shared only with who you choose.

**Description:**
> Dayline is a private, close-friend-first way to remember your actual
> life — not a feed, not a public profile, no follower counts.
>
> A few times a day, Dayline nudges you to capture five seconds of
> whatever's happening. At the end of the day, those moments become one
> short, cinematic montage — just for you.
>
> Want to share it? Choose a small group of up to 10 close friends and
> contribute the moments you want them to see. Everyone's clips combine
> into "Our Day" — a shared film only your group ever sees.
>
> • Private by default — nothing is shared unless you choose to
> • No public likes, follower counts, or performance pressure
> • Automatic daily montages from your own five-second clips
> • Small private groups, capped at 10 people
> • Memories resurface later — a week, a month, a year on
>
> Dayline is currently in private beta.

**Keywords:** private journal, close friends, daily video diary, five
second video, group montage, private social, memory app

**App Review notes:** Dayline requires camera and microphone permission
to record 5-second clips, and photo library permission to save/export
finished montages. Account creation uses Supabase email/password auth. A
demo account is available on request — see `docs/OWNER_ACTIONS_REQUIRED.md`
for providing reviewer credentials once a production project exists.

## Google Play

**Short description** (80 char): Five-second daily moments, private
montages, shared only with your closest friends.

**Full description:** (same content as the App Store description above,
reformatted per Play's plain-text requirements)

## Screenshot shot list

1. Welcome screen — tagline + wordmark
2. Today timeline mid-day — a mix of completed/upcoming slots
3. Capture screen — countdown mid-recording
4. "Your Day Is Ready" reveal — montage playback
5. Group detail screen — invite code + member roster
6. "Our Day" group montage playback with reactions/comments visible
7. Memories screen — On This Day resurfacing
8. Settings — privacy-forward framing (blocked users, export, delete)

## App preview video storyboard (15–30s)

1. (0–3s) Notification appears: "Capture this moment"
2. (3–6s) Countdown recording, 5→0
3. (6–10s) Quick montage of several capture moments through a day
4. (10–15s) "Your Day Is Ready" reveal, montage plays
5. (15–22s) Share to a small group, "Our Day" combined montage
6. (22–28s) Memories resurfacing a moment from a year ago
7. (28–30s) Wordmark + tagline: "Don't perform your life. Remember it."

## Support FAQ (for a support page / App Store support URL)

See the in-app version at Settings → Support (`mobile/src/app/(app)/settings/support.tsx`)
for the canonical copy — kept in sync manually for now:
- Who can see my clips? Only you, until you explicitly share one to a group.
- Can I capture without a reminder? Yes — tap "Capture a moment" anytime.
- What happens if I miss a reminder? Nothing bad — just marked missed, no streaks or shame.
- How do I leave a group? Group screen → scroll down → Leave (or Delete if you own it).
- How do I delete my account? Settings → Privacy & data → Delete my account.

## Beta invitation copy (draft)

> You're invited to try Dayline — a private way to capture your actual
> day, five seconds at a time, and turn it into a short film you and a
> few close friends can watch back. No public feed, no followers, no
> performance. [invite link / code]

## Campus ambassador / referral pilot plan (draft)

A single-campus pilot matches the "close friend group" product thesis
well (dorms, friend circles, small clubs):
1. Recruit 5–10 student ambassadors per target campus, each seeded with
   invite codes for their own friend group.
2. Ambassadors get early access + a small non-cash incentive (Plus
   subscription, merch) — avoid pay-per-invite schemes that could read as
   incentivized/fake engagement to app store reviewers.
3. Track adoption via `analytics_events` (event names only — no PII in
   event properties, consistent with `docs/PRIVACY_DATA_FLOW.md`).
4. Collect qualitative feedback via the in-app support contact before
   expanding beyond the pilot campus.
5. Referral attribution: the existing 6-character invite-code system
   already supports this (a distinct code per ambassador/group);
   dedicated referral-tracking analytics events are a reasonable Milestone
   6-scope addition (see `ROADMAP.md`), not yet built.

## Privacy-first launch messaging (draft)

Lead with what Dayline is *not*: not a public feed, no follower counts,
no algorithmic ranking, no ads, no selling data. Lead with what it *is*:
a private daily-memory habit for you and the handful of people you
actually see and text every day. This positioning should show up
consistently in App Store copy, launch social posts, and press outreach —
it's the product's actual differentiator, not just a privacy footnote.

## Trademark / domain verification checklist (owner action)

- [ ] Search USPTO (or relevant jurisdiction's trademark office) for
      "Dayline" in relevant classes (software/apps).
- [ ] Search for existing apps/companies named "Dayline" on the App
      Store and Play Store.
- [ ] Check domain availability (dayline.app, dayline.com, etc.).
- [ ] Check social handle availability on relevant platforms.
- [ ] If any conflict is found, pick a new name using the alternate
      candidates in `PRODUCT.md` — the codebase centralizes the name in
      `mobile/src/constants/brand.ts` specifically so this is a one-file
      change, not a repo-wide find/replace.

**None of the above has been done in this session** — it requires real
trademark database access and a business decision, both explicitly
nondelegable per the task's own instructions.
