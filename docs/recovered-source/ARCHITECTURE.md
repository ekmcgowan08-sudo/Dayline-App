# Architecture

## Stack decision and why

- **Expo + React Native + TypeScript**: single codebase for iOS and Android, fast iteration, good camera/notification module support, no need to hire native iOS/Android engineers for the MVP.
- **Supabase** (Postgres + Auth + Storage + Edge Functions) over Firebase: real SQL (easier group/permission joins than a NoSQL model), built-in Row Level Security maps cleanly onto "private by default" media, generous free tier, and Postgres gives you a real migration story as the schema grows.
- **Private Storage buckets + signed URLs**: clips and montages are never public. Every playback URL is short-lived and generated server-side per request (rule 8 in the spec: never expose private videos through predictable public URLs).
- **Client-side local notifications for MVP, server-side scheduler later**: `expo-notifications` gets you a working reminder loop with zero backend cost. It only fires while the schedule has been computed on-device, so a v2 should add a cron-based Edge Function pushing via Expo's push service so reminders survive app kills/reinstalls.
- **ffmpeg-based rendering, not yet wired**: Deno Edge Functions can't run ffmpeg. The real renderer should be a small always-on or on-demand worker (e.g., a lightweight container on Fly.io or Render, or a queued job processed by a Node worker) that Supabase enqueues via a Postgres row + `pg_net`/webhook, or a simple polling worker. This is intentionally decoupled behind the `montages` table's `status` field so the rendering backend can change without touching the app.

## Data flow (individual daily montage)

1. App uploads each clip to `clips` bucket at `clips/{userId}/{timestamp}.mp4`, inserts a `clips` row.
2. User taps "Generate Daily Montage" -> app calls `render-montage` Edge Function.
3. Function inserts a `montages` row with `status = 'processing'`.
4. (Not yet implemented) A worker picks up processing montages, downloads the day's clips via service-role access, runs ffmpeg concat + transitions + captions, uploads the result to the `montages` bucket, sets `status = 'ready'` and `storage_path`.
5. App polls the `montages` row; once `ready`, requests a signed URL and plays the video.

## Data flow (group montage)

Same as above but the `montages` row has `group_id` set instead of `user_id`, and the renderer pulls clips from every member of that group for the given date. Access is governed by the `group_members` RLS policy, not by the storage URL itself.

## Security model

Everything is RLS-first: a user can only ever see their own clips, their own or group montages they belong to, and group membership rows for groups they're in. The anon key shipped in the app can never read another user's private data because Postgres enforces it, not client code.
