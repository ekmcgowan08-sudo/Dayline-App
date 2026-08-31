// Storage cost control — the "aggressively expire raw clips after the
// montage is rendered; keep only the finished montage" lever documented
// in COSTS.md. Removes the storage object for clips the render worker
// already marked 'used' (i.e. incorporated into their owner's own
// personal montage — see worker/src/render/runJob.ts) once they're past
// a retention window, keeping the database row itself (so
// montage_clips history and "what was in today's montage" stay intact).
//
// Intended to run on a schedule (e.g. daily) via the same pg_cron + pg_net
// setup as send-capture-reminders — see docs/DEPLOYMENT.md.
//
// Deploy: supabase functions deploy purge-used-clips --no-verify-jwt
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
// Env optional: RAW_CLIP_RETENTION_DAYS (default 7)
import { adminClient, json, CORS_HEADERS } from '../_shared/client.ts';

const DEFAULT_RETENTION_DAYS = 7;
const BATCH_SIZE = 500;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedAuth = req.headers.get('Authorization');
  if (!cronSecret || providedAuth !== `Bearer ${cronSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const retentionDays = Number(Deno.env.get('RAW_CLIP_RETENTION_DAYS') ?? DEFAULT_RETENTION_DAYS);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const admin = adminClient();

  const { data: candidates, error: queryError } = await admin
    .from('clips')
    .select('id, storage_path')
    .eq('status', 'used')
    .is('storage_purged_at', null)
    .is('deleted_at', null)
    .lt('captured_at', cutoff.toISOString())
    .limit(BATCH_SIZE);

  if (queryError) return json({ error: queryError.message }, 500);
  if (!candidates || candidates.length === 0) return json({ ok: true, purged: 0 });

  const { error: removeError } = await admin.storage.from('clips').remove(candidates.map((c) => c.storage_path));
  if (removeError) {
    // If storage removal fails, don't mark these purged — they'll be
    // retried on the next scheduled run instead of silently losing track
    // of a file that's actually still there.
    return json({ error: removeError.message }, 500);
  }

  const { error: updateError } = await admin
    .from('clips')
    .update({ storage_purged_at: new Date().toISOString() })
    .in('id', candidates.map((c) => c.id));
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ ok: true, purged: candidates.length, retentionDays });
});
