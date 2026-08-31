# Privacy & Data Flow

Companion to `PRIVACY.md` (the user-facing draft policy) — this document
is the technical detail: what data exists, where it flows, who can touch
it, and what happens when a user deletes something.

## Data inventory

| Data | Where it lives | Who can read it (besides the owner) |
|---|---|---|
| Email, auth credentials | Supabase `auth.users` | Nobody except via account recovery flows Supabase itself provides |
| Display name, avatar, timezone | `profiles` | Group members you've shared a montage with (display name/avatar only, for attribution) |
| Raw video clips | `clips` bucket + `clips` table | Nobody. Not even group members — see below |
| Capture schedule | `notification_preferences` | Nobody |
| Rendered personal montage | `montages` bucket + row (`user_id` set) | Nobody |
| Rendered group montage | `montages` bucket + row (`group_id` set) | Current members of that group only, via a signed URL issued after a server-side membership check |
| Group contribution choice | `group_contributions` | Only you (which of your own clips you've opted into which group) |
| Comments/reactions | `comments`, `reactions` | Members with access to that montage, minus anyone you've blocked (mutually hidden) |
| Reports | `reports` | You (your own filed reports) and, operationally, moderators via direct database access — see `docs/MODERATION_RUNBOOK.md` |
| Push token | `device_push_tokens` | Nobody (used only to address a push notification to your device) |
| Subscription status | `subscriptions` | Nobody but you (read-only for the client either way) |
| Minimal analytics | `analytics_events` | Operators only, for product/bug analysis — event *names* and timestamps, **never raw clip content or comment text** |
| AI caption consent + generated caption | `transcription_consents`, `clips.caption` | Nobody but you — captions aren't currently surfaced to group members |

## The one deliberate exception: group montages

Raw clips are never shared. What group members actually see is a
*rendered video file* the worker produced from clips their fellow members
each explicitly chose to contribute (`group_contributions`) — there is no
code path, RLS policy, or API that lets a group member enumerate,
download, or preview another member's raw storage objects. The render
worker (server-side, service-role) is the only thing that ever reads
multiple people's raw clips for a single montage, and it only writes back
the finished combined video.

## AI captions data flow (opt-in, off by default)

1. Feature flag off by default (`EXPO_PUBLIC_FEATURE_AI_CAPTIONS`).
2. Even with the flag on, nothing happens until the user flips a personal
   consent toggle (`transcription_consents.consented`).
3. Even then, nothing happens until the user requests a caption for one
   specific clip (no bulk/automatic captioning).
4. The `transcribe` Edge Function checks consent server-side (not just
   trusting the client), signs a short-lived URL for that one clip, and
   sends it to the configured provider (`mock` by default — no network
   call at all; `openai` if explicitly configured with a key, sending
   only that one clip's audio).
5. The provider's transcript is stored in `clips.caption`. Nothing about
   the video content is retained by this pipeline beyond that text.
6. Disabling consent doesn't retroactively delete existing captions in
   this build — deleting the clip does (see below). This is a known,
   documented gap for a future "delete all my captions" affordance.

**No clip is ever used to train a model** — Dayline doesn't have training
infrastructure, and the provider abstraction sends only the single
requested clip per call, nothing else.

## Retention & deletion

- **Deleting a clip** (`services/clips.ts#deleteClip`): soft-deletes the
  row via `delete_own_clip` (`deleted_at` set, excluded from every query)
  *and* removes the underlying video file from the `clips` bucket — the
  client reads the storage path before the RPC call, then calls
  `storage.remove()` after it succeeds.
- **Deleting a personal montage** (`services/montages.ts#deletePersonalMontage`):
  same pattern — the row is hard-deleted via `delete_own_personal_montage`
  and the rendered video file is removed from the `montages` bucket.
- **Deleting your account**: see `docs/SECURITY.md` and
  `docs/DECISIONS.md` — storage objects for your clips and personal
  montages are actually removed, then the auth user is deleted, cascading
  through every table. Group montages you contributed to are **not**
  deleted (they belong to the group, not you individually) — only your
  own membership/contribution rows are removed via the cascade.
- **Data export**: `request_data_export()` records a genuine, auditable
  request (deduped — calling it again while a request is still pending is
  a no-op, so tapping the button twice doesn't queue duplicate work).
  Fulfillment is automated: a scheduled Edge Function
  (`fulfill-data-export`, same `pg_cron` mechanism as the capture-reminder
  and clip-purge backup jobs — see `docs/DEPLOYMENT.md`) compiles the
  requester's profile, clips metadata (no raw video, no storage paths —
  just what was captured and when), montages, group memberships, authored
  comments/reactions/reports, subscription status, and notification/
  transcription preferences into one JSON file, uploaded to a private
  `exports` storage bucket. No email-sending infrastructure is needed:
  the user retrieves it entirely in-app, via a short-lived signed URL
  from `get-export-url` (the same ownership-checked-server-side pattern
  `get-montage-url` already uses for montage playback) — see Settings →
  Privacy & data.

## Minimal analytics

`analytics_events` stores an event name, optional JSON `properties`
(never raw media, never comment/message bodies), and a timestamp. No
analytics event schema in this codebase currently writes clip content,
video URLs, or full comment text into `properties` — this is a convention
to enforce in code review going forward, not (yet) a database-level
constraint, since Postgres can't easily validate "this jsonb blob doesn't
contain anything sensitive."
