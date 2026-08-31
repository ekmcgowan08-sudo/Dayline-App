// Issues a short-lived signed URL for a fulfilled data-export request
// after checking ownership server-side — the same pattern
// get-montage-url uses for montage playback. The `exports` storage
// bucket has zero client-facing RLS policies (see
// supabase/migrations/20260831210000_data_export_fulfillment.sql), so a
// client's own session key cannot read it directly no matter what.
//
// Deploy: supabase functions deploy get-export-url
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { adminClient, authenticate, json, CORS_HEADERS } from '../_shared/client.ts';

const SIGNED_URL_TTL_SECONDS = 60 * 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  const { userId } = auth;

  let body: { requestId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.requestId) return json({ error: 'request_id_required' }, 400);

  const admin = adminClient();
  const { data: request } = await admin
    .from('data_export_requests')
    .select('*')
    .eq('id', body.requestId)
    .maybeSingle();

  if (!request || request.user_id !== userId) return json({ error: 'not_found' }, 404);
  if (request.status !== 'fulfilled' || !request.storage_path) {
    return json({ ok: true, status: request.status });
  }

  const { data: signed, error } = await admin.storage
    .from('exports')
    .createSignedUrl(request.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error) return json({ error: 'signing_failed' }, 500);

  return json({ ok: true, status: 'fulfilled', url: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
});
