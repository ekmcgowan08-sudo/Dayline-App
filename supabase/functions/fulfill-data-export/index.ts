// Automated data-export fulfillment — the piece
// docs/PRIVACY_DATA_FLOW.md previously documented as a manual operator
// step (no email-sending infrastructure exists in this build, so
// fulfillment used to mean "someone with service-role access compiles a
// file and emails it by hand"). This compiles the same data
// automatically and uploads it to the private `exports` bucket; the user
// retrieves it in-app via get-export-url's signed URL, no email needed.
//
// Deliberately metadata-only for clips/montages (no storage_path, i.e.
// no direct link to the raw media) — matches what
// docs/PRIVACY_DATA_FLOW.md already promised before this function
// existed: "profile, clips metadata, and montages," not raw video.
//
// Intended to run on a schedule via the same pg_cron + pg_net setup as
// send-capture-reminders/purge-used-clips — see docs/DEPLOYMENT.md.
//
// Deploy: supabase functions deploy fulfill-data-export --no-verify-jwt
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
import { adminClient, json, CORS_HEADERS } from '../_shared/client.ts';

const BATCH_SIZE = 25;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedAuth = req.headers.get('Authorization');
  if (!cronSecret || providedAuth !== `Bearer ${cronSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = adminClient();

  const { data: pending, error: queryError } = await admin
    .from('data_export_requests')
    .select('id, user_id, requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (queryError) return json({ error: queryError.message }, 500);
  if (!pending || pending.length === 0) return json({ ok: true, fulfilled: 0 });

  let fulfilled = 0;
  const failures: string[] = [];

  for (const request of pending) {
    try {
      const userId = request.user_id;

      const [profile, clips, montages, groupMemberships, comments, reactions, reports, subscription, notificationPrefs, transcriptionConsent] =
        await Promise.all([
          admin.from('profiles').select('display_name, timezone, created_at').eq('id', userId).maybeSingle(),
          admin.from('clips').select('id, duration_ms, captured_at, status, created_at').eq('user_id', userId).is('deleted_at', null),
          admin
            .from('montages')
            .select('id, session_date, kind, status, clip_count, created_at, ready_at')
            .or(`user_id.eq.${userId},requested_by.eq.${userId}`),
          admin.from('group_members').select('group_id, role, joined_at').eq('user_id', userId),
          admin.from('comments').select('montage_id, body, created_at').eq('user_id', userId).is('deleted_at', null),
          admin.from('reactions').select('montage_id, emoji, created_at').eq('user_id', userId),
          admin.from('reports').select('target_type, target_id, reason, created_at').eq('reporter_id', userId),
          admin.from('subscriptions').select('tier, entitlement, status, expires_at').eq('user_id', userId).maybeSingle(),
          admin.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
          admin.from('transcription_consents').select('consented, updated_at').eq('user_id', userId).maybeSingle(),
        ]);

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        requestId: request.id,
        requestedAt: request.requested_at,
        profile: profile.data ?? null,
        clips: clips.data ?? [],
        montages: montages.data ?? [],
        groupMemberships: groupMemberships.data ?? [],
        comments: comments.data ?? [],
        reactions: reactions.data ?? [],
        reportsFiled: reports.data ?? [],
        subscription: subscription.data ?? null,
        notificationPreferences: notificationPrefs.data ?? null,
        transcriptionConsent: transcriptionConsent.data ?? null,
        note: 'Raw video files are not included — this export covers your account metadata and activity. Clips and montages remain playable in the app for as long as your account exists.',
      };

      const storagePath = `${userId}/${request.id}.json`;
      const { error: uploadError } = await admin.storage
        .from('exports')
        .upload(storagePath, new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' }), {
          upsert: true,
        });
      if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

      const { error: updateError } = await admin
        .from('data_export_requests')
        .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString(), storage_path: storagePath })
        .eq('id', request.id);
      if (updateError) throw new Error(`row update failed: ${updateError.message}`);

      fulfilled++;
    } catch (e) {
      // Leave this request 'pending' — non-fatal, it's retried on the
      // next scheduled run rather than silently losing track of it.
      failures.push(`${request.id}: ${(e as Error).message}`);
    }
  }

  return json({ ok: true, fulfilled, failed: failures.length, failures: failures.length > 0 ? failures : undefined });
});
