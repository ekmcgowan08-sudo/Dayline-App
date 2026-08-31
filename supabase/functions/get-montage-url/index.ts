// Issues a short-lived signed URL for a finished montage after checking
// ownership/group-membership server-side. This is the ONLY path a client
// ever gets montage playback through — the `montages` storage bucket has
// zero client-facing RLS policies (see
// supabase/migrations/20260831060000_storage_buckets.sql and the S9 proof
// in supabase/tests/rls_security.test.sql), so a client's own session key
// cannot read it directly no matter what.
//
// Deploy: supabase functions deploy get-montage-url
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { adminClient, authenticate, json, CORS_HEADERS } from '../_shared/client.ts';

const SIGNED_URL_TTL_SECONDS = 60 * 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  const { userId } = auth;

  let body: { montageId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.montageId) return json({ error: 'montage_id_required' }, 400);

  const admin = adminClient();
  const { data: montage } = await admin.from('montages').select('*').eq('id', body.montageId).maybeSingle();
  if (!montage) return json({ error: 'not_found' }, 404);

  let authorized = montage.user_id === userId;
  if (!authorized && montage.group_id) {
    const { data: membership } = await admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', montage.group_id)
      .eq('user_id', userId)
      .maybeSingle();
    authorized = !!membership;
  }
  if (!authorized) return json({ error: 'not_authorized' }, 403);

  if (montage.status !== 'ready' || !montage.storage_path) {
    return json({ ok: true, status: montage.status, errorCode: montage.error_code ?? null });
  }

  const { data: signed, error } = await admin.storage
    .from('montages')
    .createSignedUrl(montage.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error) return json({ error: 'signing_failed' }, 500);

  return json({ ok: true, status: 'ready', url: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
});
