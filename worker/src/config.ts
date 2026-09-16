function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 5000),
  staleClaimSeconds: Number(process.env.STALE_CLAIM_SECONDS ?? 600),
  maxRetries: Number(process.env.MAX_RETRIES ?? 3),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  healthPort: Number(process.env.PORT ?? 8080),
  tmpDir: process.env.WORKER_TMP_DIR ?? '/tmp/dayline-worker',
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  /** Kills a single ffmpeg/ffprobe invocation if it runs longer than this
   * — see docs/IMPLEMENTATION_STATUS.md Phase 53. Without it, a hung
   * process (corrupt/pathological input, a stuck read on unusual
   * storage) blocks this worker's single-job-at-a-time poll loop
   * forever, since node:child_process.execFile has no default timeout.
   * 3 minutes is generous for any one call in this pipeline (each
   * segment is at most an 8-second clip at a fast preset) while staying
   * well under staleClaimSeconds, so the same worker instance can fail
   * the job and resume polling itself rather than needing a second
   * replica or a manual restart to notice. */
  ffmpegTimeoutMs: Number(process.env.FFMPEG_TIMEOUT_MS ?? 180_000),
  /** Same reasoning as ffmpegTimeoutMs, applied to every PostgREST/
   * Storage network call instead of every ffmpeg invocation — see
   * docs/IMPLEMENTATION_STATUS.md Phase 54. Neither Node's own `fetch`
   * nor supabase-js sets a default timeout, so a hung network call
   * (stalled connection, wedged proxy) would otherwise block this
   * worker's single-job poll loop forever, same as the ffmpeg case. 60
   * seconds is generous for a slow clip/montage upload or download on a
   * poor connection while staying well under staleClaimSeconds. */
  supabaseRequestTimeoutMs: Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS ?? 60_000),
  titleCardFontPath: process.env.TITLE_CARD_FONT_PATH ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  /** Optional — Expo's enhanced push security token, same as the
   * EXPO_ACCESS_TOKEN send-capture-reminders' Edge Function optionally
   * uses. Not required for basic push sending. */
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? '',
} as const;
