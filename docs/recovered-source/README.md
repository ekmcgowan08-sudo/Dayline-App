# Dayline (working name)

"Don't perform your life. Remember it."

A private, friend-group-first micro-vlogging app: capture ~5 second clips
throughout your day, get an automatic daily montage, and share an "Our Day"
episode with a small group of close friends.

## Build status (be exact about this)

**Implemented and present as real source files:**
- Expo/React Native + TypeScript app shell with navigation
- Supabase auth (email/password) - signup, login, session persistence
- Capture schedule screen + local notification scheduler (`src/services/notifications.ts`)
- Camera capture screen (5s clip) using `expo-camera`
- Secure-by-default clip upload to private Supabase Storage (no public URLs, signed URLs only)
- Today's Clips list, montage viewer screen with polling + signed playback URL
- Groups: create group with invite code, join by code, member cap enforcement
- Full Postgres schema with Row Level Security policies (`supabase/migrations/0001_init.sql`)
- Edge Function contract for montage generation (`supabase/functions/render-montage`)

**Requires external setup before it runs (I cannot do these for you - no internet/credentials in this environment):**
- Create a Supabase project and run the migration
- Create two private storage buckets: `clips`, `montages`
- Fill in `.env` from `.env.example`
- `npx expo install` to resolve native module versions for your Expo SDK
- Apple/Google developer accounts for real device builds and push notifications
- RevenueCat account for subscriptions (not yet wired into the code)

**Not yet implemented (by design, flagged honestly, not faked):**
- Actual ffmpeg video rendering (the Edge Function creates the montage row but does not yet concatenate video - see the TODO in `render-montage/index.ts`)
- Transcription/captions/AI summaries
- Push notifications via a server-side scheduler (current scheduler is client-side/local only)
- Subscription entitlement checks
- Export to Instagram/TikTok/etc.
- Automated test suite

## Why nothing here is claimed as "verified"

This was generated in a sandboxed environment with no internet access and no
mobile build toolchain, so `npm install`, `expo start`, and Supabase
connectivity have not actually been executed against real infrastructure.
Treat every file as "should work, unverified" until you run it yourself.

## How to run it

1. `cd dayline-app && npm install`
2. Create a free project at supabase.com, then in the SQL editor run the contents of `supabase/migrations/0001_init.sql`
3. In Supabase Storage, create two **private** buckets named `clips` and `montages`
4. `cp .env.example .env` and fill in your Supabase URL + anon key
5. `npx expo start` and open in Expo Go on your phone (camera/mic won't work in the web preview)

## Repository structure

```
src/
  screens/       one file per screen (Login, Camera, Groups, Montage, etc.)
  services/      clips.ts (upload/list), notifications.ts (scheduler)
  lib/            supabase.ts (client), auth.tsx (session context)
supabase/
  migrations/     0001_init.sql - full schema + RLS
  functions/      render-montage - Edge Function stub for video pipeline
```

See also: `ARCHITECTURE.md`, `PRODUCT.md`, `ROADMAP.md`, `COSTS.md`, `LAUNCH_CHECKLIST.md`.
