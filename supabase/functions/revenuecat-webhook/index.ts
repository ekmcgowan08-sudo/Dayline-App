// Receives RevenueCat webhook events and is the ONLY writer of the
// `subscriptions` table (via the service role — RLS gives the
// authenticated/anon roles zero write access to that table on purpose,
// see supabase/migrations/20260831040000_subscriptions_entitlements.sql
// and the S6 proof in supabase/tests/rls_security.test.sql: a client can
// never self-grant a paid entitlement).
//
// VERIFICATION NOTE: this environment's outbound network access could not
// reach revenuecat.com to confirm the current exact payload shape and
// auth-header convention against live docs (see docs/DECISIONS.md). The
// shape below matches RevenueCat's long-documented webhook structure
// (event.{type, app_user_id, product_id, entitlement_ids, expiration_at_ms,
// purchased_at_ms, period_type}) and its shared-secret Authorization
// header — confirm both against https://www.revenuecat.com/docs/integrations/webhooks
// before relying on this in production, and update REVENUECAT_WEBHOOK_SECRET
// to match the value configured in the RevenueCat dashboard.
//
// Deploy: supabase functions deploy revenuecat-webhook --no-verify-jwt
// (RevenueCat calls this directly, not as a logged-in Supabase user, so
// the default Supabase JWT check must be disabled for this one function;
// auth instead comes from REVENUECAT_WEBHOOK_SECRET below.)
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REVENUECAT_WEBHOOK_SECRET
import { adminClient, json } from '../_shared/client.ts';

type RevenueCatEvent = {
  type: string;
  app_user_id: string;
  product_id?: string;
  entitlement_ids?: string[];
  period_type?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
};

const ENTITLEMENT_ID_PLUS = 'plus';

const EXPIRING_EVENT_TYPES = new Set(['CANCELLATION', 'EXPIRATION']);

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const providedAuth = req.headers.get('Authorization');
  if (!expectedSecret || providedAuth !== `Bearer ${expectedSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { event?: RevenueCatEvent };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const event = body.event;
  if (!event?.app_user_id || !event.type) return json({ error: 'malformed_event' }, 400);

  const admin = adminClient();

  // Webhook senders generally retry on transient failures with no
  // delivery-order guarantee. A redelivered older event (e.g. a stale
  // CANCELLATION retry arriving after a newer upgrade already applied)
  // must not overwrite a subscription with stale data — see the
  // migration comment on subscriptions.last_event_at.
  const incomingEventAt = event.purchased_at_ms ? new Date(event.purchased_at_ms) : null;
  if (incomingEventAt) {
    const { data: existing } = await admin.from('subscriptions').select('last_event_at').eq('user_id', event.app_user_id).maybeSingle();
    if (existing?.last_event_at && new Date(existing.last_event_at) > incomingEventAt) {
      return json({ ok: true, skipped: 'stale_event' });
    }
  }

  const hasPlus = (event.entitlement_ids ?? []).includes(ENTITLEMENT_ID_PLUS);
  const expired = EXPIRING_EVENT_TYPES.has(event.type);

  const { error } = await admin.from('subscriptions').upsert({
    user_id: event.app_user_id,
    tier: hasPlus && !expired ? 'plus' : 'free',
    entitlement: hasPlus && !expired ? 'plus' : 'free',
    status: expired ? 'expired' : 'active',
    product_id: event.product_id ?? null,
    revenuecat_app_user_id: event.app_user_id,
    period_type: (event.period_type?.toLowerCase() as 'normal' | 'trial' | 'intro' | 'grace' | undefined) ?? null,
    expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
    will_renew: !expired,
    ...(incomingEventAt ? { last_event_at: incomingEventAt.toISOString() } : {}),
    updated_at: new Date().toISOString(),
  });

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
