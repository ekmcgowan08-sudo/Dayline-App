// Drains the pending_storage_purges queue a BEFORE DELETE trigger on
// `montages` fills whenever a montages row is deleted — primarily
// delete_group() and leave_group()'s last-member-leaving auto-delete path
// (supabase/migrations/20260831020000_groups_hardening.sql), which cascade
// the DB row via `on delete cascade` but have no way to reach Supabase
// Storage's HTTP API to remove the actual video file, leaving it orphaned
// in the 'montages' bucket forever. See
// supabase/migrations/20260902010000_orphaned_montage_storage_purge.sql
// for the full story and why this is queue-based rather than special-
// cased to group deletion.
//
// Intended to run on a schedule (e.g. daily) via the same pg_cron + pg_net
// setup as purge-used-clips/send-capture-reminders — see
// docs/DEPLOYMENT.md.
//
// Deploy: supabase functions deploy purge-orphaned-montages --no-verify-jwt
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
import { adminClient, json, CORS_HEADERS } from '../_shared/client.ts';

const BATCH_SIZE = 500;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedAuth = req.headers.get('Authorization');
  if (!cronSecret || providedAuth !== `Bearer ${cronSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = adminClient();

  const { data: pending, error: queryError } = await admin
    .from('pending_storage_purges')
    .select('id, bucket, storage_path')
    .is('purged_at', null)
    .order('queued_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (queryError) return json({ error: queryError.message }, 500);
  if (!pending || pending.length === 0) return json({ ok: true, purged: 0 });

  // Grouped by bucket since storage.remove() operates on one bucket at a
  // time; every row today is 'montages', but this stays correct if the
  // queue ever gains a second bucket.
  const byBucket = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byBucket.get(row.bucket) ?? [];
    list.push(row);
    byBucket.set(row.bucket, list);
  }

  let purged = 0;
  const failures: string[] = [];

  for (const [bucket, rows] of byBucket) {
    const paths = [...new Set(rows.map((r) => r.storage_path))];
    // Storage object removal is idempotent (deleting an already-gone or
    // never-existed key succeeds — proven empirically this session), so a
    // path queued twice (e.g. delete-account already removed a personal
    // montage's file directly, then this same row's delete also queued
    // it) or a path that's already gone is not an error here.
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) {
      failures.push(`${bucket}: ${removeError.message}`);
      continue;
    }
    const { error: updateError } = await admin
      .from('pending_storage_purges')
      .update({ purged_at: new Date().toISOString() })
      .in(
        'id',
        rows.map((r) => r.id)
      );
    if (updateError) {
      failures.push(`${bucket} row update: ${updateError.message}`);
      continue;
    }
    purged += rows.length;
  }

  return json({ ok: true, purged, failed: failures.length, failures: failures.length > 0 ? failures : undefined });
});
