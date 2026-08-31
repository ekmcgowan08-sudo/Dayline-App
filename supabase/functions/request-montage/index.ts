// Creates (or idempotently returns) a montage render job. Replaces the
// recovered baseline's stub, which only ever inserted a 'processing' row
// and never produced a real video — this still just inserts/updates the
// row (the real rendering happens in worker/), but now with idempotency,
// authorization, rate limiting, and a real eligible-clip check instead of
// blindly accepting any request.
//
// Deploy: supabase functions deploy request-montage
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { adminClient, authenticate, json, CORS_HEADERS } from '../_shared/client.ts';

type RequestBody = {
  scope?: 'personal' | 'group';
  groupId?: string;
  date?: string; // YYYY-MM-DD, in the caller's local timezone; defaults to UTC today
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  const { userId } = auth;

  const admin = adminClient();

  const { data: allowed, error: rateLimitError } = await admin.rpc('check_rate_limit', {
    p_bucket: 'request-montage',
    p_subject: userId,
    p_max_events: 20,
    p_window_seconds: 3600,
  });
  if (rateLimitError) return json({ error: 'rate_limit_check_failed' }, 500);
  if (!allowed) return json({ error: 'rate_limited' }, 429);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (body.scope !== 'personal' && body.scope !== 'group') return json({ error: 'invalid_scope' }, 400);
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);

  const ownerFilter: { user_id: string | null; group_id: string | null } =
    body.scope === 'personal' ? { user_id: userId, group_id: null } : { user_id: null, group_id: body.groupId ?? '' };

  if (body.scope === 'group') {
    if (!body.groupId) return json({ error: 'group_id_required' }, 400);
    const { data: membership } = await admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', body.groupId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) return json({ error: 'not_a_member' }, 403);
  }

  const { data: existing } = await admin
    .from('montages')
    .select('*')
    .match({ ...ownerFilter, session_date: date })
    .maybeSingle();

  if (existing) {
    if (['processing', 'retrying', 'ready'].includes(existing.status)) {
      return json({ ok: true, montageId: existing.id, status: existing.status });
    }
    // 'failed' or 'expired': allow a fresh attempt on the same row (unique
    // index means there can only ever be one montage per owner+date).
    const { data: updated, error } = await admin
      .from('montages')
      .update({ status: 'processing', error_code: null, claimed_at: null, claimed_by: null })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, montageId: updated.id, status: updated.status });
  }

  let clipCount = 0;
  if (body.scope === 'personal') {
    const { count } = await admin
      .from('clips')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('captured_at', `${date}T00:00:00.000Z`)
      .lte('captured_at', `${date}T23:59:59.999Z`);
    clipCount = count ?? 0;
  } else {
    // A quick UI-facing estimate only; the worker does the authoritative,
    // date-scoped join against group_contributions + clips at render time.
    const { count } = await admin
      .from('group_contributions')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', body.groupId);
    clipCount = count ?? 0;
  }
  if (clipCount === 0) return json({ error: 'no_eligible_clips' }, 400);

  const idempotencyKey = `${body.scope}:${body.scope === 'personal' ? userId : body.groupId}:${date}`;
  const { data: created, error: insertError } = await admin
    .from('montages')
    .insert({
      ...ownerFilter,
      session_date: date,
      status: 'processing',
      kind: body.scope,
      requested_by: userId,
      idempotency_key: idempotencyKey,
      clip_count: clipCount,
    })
    .select()
    .single();

  if (insertError) {
    // Most likely a unique-index race with a concurrent identical request;
    // return the row that won instead of erroring the second caller.
    const { data: raced } = await admin
      .from('montages')
      .select('*')
      .match({ ...ownerFilter, session_date: date })
      .maybeSingle();
    if (raced) return json({ ok: true, montageId: raced.id, status: raced.status });
    return json({ error: insertError.message }, 500);
  }

  return json({ ok: true, montageId: created.id, status: created.status });
});
