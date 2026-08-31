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
  titleCardFontPath: process.env.TITLE_CARD_FONT_PATH ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  /** Optional — Expo's enhanced push security token, same as the
   * EXPO_ACCESS_TOKEN send-capture-reminders' Edge Function optionally
   * uses. Not required for basic push sending. */
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? '',
} as const;
