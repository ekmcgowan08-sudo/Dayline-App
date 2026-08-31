# Dayline render worker

A small, portable Node.js + ffmpeg worker that turns a day's raw 5-second
clips into a finished portrait (9:16) montage. It replaces the recovered
prototype's `render-montage` Edge Function, which only ever inserted a
`processing` row and never actually rendered anything.

## How it works

1. Polls Postgres (`claim_next_montage_job` RPC — see
   `supabase/migrations/20260831130000_worker_job_claim.sql`) for montage
   rows in `processing`/`retrying` status, claiming one at a time with
   `FOR UPDATE SKIP LOCKED` so multiple worker instances never double-process
   the same job.
2. Looks up that day's eligible clips fresh at render time (personal: the
   owner's own clips; group: only clips explicitly contributed via
   `group_contributions` — see `src/render/fetchEligibleClips.ts`).
3. Downloads each clip from the private `clips` Storage bucket using the
   service-role key (never a client signed URL).
4. Normalizes every clip to a shared format — portrait 1080×1920, 30fps,
   h264/aac, fade in/out — synthesizing silent audio for clips that have
   none, and skipping (not failing the whole job for) any clip that's
   missing or corrupt.
5. Optionally prepends a generated date/title card.
6. Concatenates the normalized segments (stream-copy, since they now share
   identical codec parameters) into the final montage.
7. Uploads the result to the private `montages` bucket, records which
   clips made the final cut (in order) in `montage_clips`, and flips the
   montage row to `ready`.
8. On failure, retries up to `MAX_RETRIES` times (`retrying` → eventually
   `failed` with `error_code = max_retries_exceeded` — a simple dead-letter
   via the `montages.status` column itself, no separate queue needed) and
   always cleans up its temp working directory.

## Local development

```bash
cd worker
npm install
cp .env.example .env   # fill in a local Supabase project's URL + service role key
npm run build
npm start
```

`GET /health` (default port 8080) returns worker status as JSON — used by
the Dockerfile's `HEALTHCHECK` and by any container platform's health probe.

## Tests

```bash
npm test
```

This runs `src/render/__tests__/pipeline.test.ts` against **real ffmpeg**
(no mocking) using synthetic fixture clips generated on the fly by
`src/test-fixtures/generate.ts` (nothing binary is committed to the repo).
It proves, against actual ffmpeg output (not just reading the command
strings): portrait 1080×1920/30fps normalization from a landscape source,
silent-audio synthesis, corrupt-clip rejection with a typed error, title
card rendering, full multi-clip concatenation with a corrupt clip skipped
gracefully, and both "abort the job" and "no usable segments" failure
paths. It does **not** exercise the Supabase download/upload/claim code
paths — that needs a real Supabase project (or the local CLI stack), which
this sandbox could not run (see below).

## Docker

```bash
docker build -t dayline-worker .
docker run --env-file .env -p 8080:8080 dayline-worker
```

**Verification note:** this sandbox has no running Docker daemon, so the
image itself was written and reviewed but its `docker build`/`docker run`
could not be executed here. The worker logic was instead verified two
ways: (1) `npm test` above, against real ffmpeg, and (2) running
`node dist/index.js` directly against a locally-installed `ffmpeg` (via
`apt`) with a fake Supabase URL, confirming the health server, structured
logging, polling loop, and graceful SIGTERM shutdown all work end-to-end —
the only untested seam is the Docker packaging step itself and the real
Supabase network calls. See `docs/IMPLEMENTATION_STATUS.md`.

## Hosting

Any Docker-capable host works — this worker has no platform-specific
dependencies (a health endpoint, env-var config, and a plain polling loop
are the entire contract). See `docs/COSTS.md` for current pricing notes on
a few low-cost options.
