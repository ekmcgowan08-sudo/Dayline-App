import { logger } from './logger.js';
import { supabaseAdmin } from './supabaseAdmin.js';

/**
 * Mirrors `mobile/src/constants/entitlements.ts`'s `ENTITLEMENT_LIMITS` and
 * `supabase/migrations/20260831180000_entitlement_enforced_archive.sql`'s
 * hardcoded cutoff — this build has no shared source of truth between the
 * Postgres functions, the mobile bundle, and this worker, so each of the
 * three carries a comment pointing at the other two on purpose, rather than
 * silently drifting apart. If you change one, change all three.
 */
export const DAYLINE_END_CARD_REQUIRED_FOR_FREE = true;

export type Entitlement = 'free' | 'plus';

/**
 * The worker runs as the service role with no authenticated Postgres
 * session, so it can't call the `current_entitlement()` RPC (that function
 * is defined in terms of `auth.uid()`, which is null under the service
 * role). This queries the same `subscriptions` table directly, mirroring
 * `current_entitlement()`'s own logic: an active, non-expired row's
 * entitlement, defaulting to 'free' for no row / any read failure — a
 * failure here should never accidentally grant paid-tier treatment.
 */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('entitlement, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    logger.warn('failed to read entitlement; defaulting to free', { userId, error: error.message });
    return 'free';
  }
  if (!data) return 'free';
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return 'free';
  return data.entitlement === 'plus' ? 'plus' : 'free';
}
