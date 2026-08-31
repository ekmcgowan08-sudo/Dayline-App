// Deletes a user's account and applicable private media — not a soft
// "hide the profile" toggle. Called by the mobile client right after
// request_account_deletion() records intent (see
// supabase/migrations/20260831070000_account_deletion.sql). This build has
// no cron/queue infrastructure to run a scheduled grace-period purge, so
// deletion happens immediately when the user confirms; see
// docs/PRIVACY_DATA_FLOW.md for the production-grade alternative (a
// scheduled purge job) and why immediate deletion is the honest choice
// here rather than promising a grace period this repo can't actually run.
//
// Deploy: supabase functions deploy delete-account
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { adminClient, authenticate, json, CORS_HEADERS } from '../_shared/client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  const { userId } = auth;

  const admin = adminClient();

  const { data: allowed } = await admin.rpc('check_rate_limit', {
    p_bucket: 'delete-account',
    p_subject: userId,
    p_max_events: 3,
    p_window_seconds: 3600,
  });
  if (!allowed) return json({ error: 'rate_limited' }, 429);

  const { data: deletionRequest } = await admin
    .from('account_deletion_requests')
    .select('requested_at')
    .eq('user_id', userId)
    .maybeSingle();

  // 1. Remove the user's raw clip storage objects.
  const { data: clipObjects } = await admin.storage.from('clips').list(userId, { limit: 1000 });
  if (clipObjects && clipObjects.length > 0) {
    await admin.storage.from('clips').remove(clipObjects.map((o) => `${userId}/${o.name}`));
  }

  // 2. Remove storage objects for the user's own personal montages
  // (group montages are owned by the group, not an individual member, and
  // are left for the remaining group; the departing member's role in them
  // is removed via the group_members cascade below).
  const { data: personalMontages } = await admin
    .from('montages')
    .select('storage_path')
    .eq('user_id', userId)
    .not('storage_path', 'is', null);
  for (const m of personalMontages ?? []) {
    if (m.storage_path) await admin.storage.from('montages').remove([m.storage_path]);
  }

  // 3. Remove the auth user. Every table in this schema has user_id/owner
  // foreign keys with `on delete cascade` (or `on delete set null` for
  // audit-style columns like moderation_actions.actor_id) back to
  // auth.users, so this single call cascades the deletion through
  // profiles, clips, capture_slots, notification_preferences,
  // group_members, group_contributions, reactions, comments, blocks,
  // subscriptions, acceptance_records, device_push_tokens, and
  // account_deletion_requests itself.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return json({ error: 'deletion_failed' }, 500);

  // 4. Record a standalone, non-identifying audit entry that survives the
  // user row's own deletion — proof the deletion happened without
  // retaining any of the deleted person's data.
  await admin.from('account_deletion_audit').insert({
    deleted_user_id: userId,
    requested_at: deletionRequest?.requested_at ?? null,
  });

  return json({ ok: true });
});
