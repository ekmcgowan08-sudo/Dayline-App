-- Storage cost control (COSTS.md's top lever: "aggressively expire raw
-- clips after the montage is rendered; keep only the finished montage
-- long-term"). Two-step lifecycle, not an immediate delete:
--   1. The render worker marks a clip 'used' once it's been incorporated
--      into its owner's own personal montage (see worker/src/render/runJob.ts).
--      This is a fast, synchronous, in-band step.
--   2. A separate scheduled purge (purge-used-clips Edge Function) removes
--      the actual storage object for 'used' clips past a retention
--      window, keeping the database row (so montage_clips history and
--      "which clips made today's montage" stay intact) but freeing the
--      video bytes. This is deliberately decoupled from step 1 so a
--      transient storage error during rendering can never block the
--      montage from completing.

alter table clips
  add column if not exists storage_purged_at timestamptz;

create index if not exists clips_used_unpurged_idx
  on clips(captured_at)
  where status = 'used' and storage_purged_at is null and deleted_at is null;
