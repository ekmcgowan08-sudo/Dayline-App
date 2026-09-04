import { LEGAL_VERSIONS } from '../constants/legal';
import { supabase } from '../lib/supabase';

/** Idempotent: an interrupted onboarding flow (app killed/crashed after
 * this screen but before onboarding_completed_at is set) sends the user
 * back through this same screen on next launch — see
 * 20260902030000_acceptance_records_idempotent.sql for why re-recording
 * the same (user, document, version) must not create a duplicate row. */
export async function recordAcceptance(userId: string): Promise<{ error: string | null }> {
  const rows = (Object.keys(LEGAL_VERSIONS) as (keyof typeof LEGAL_VERSIONS)[]).map((document) => ({
    user_id: userId,
    document,
    version: LEGAL_VERSIONS[document],
  }));
  const { error } = await supabase
    .from('acceptance_records')
    .upsert(rows, { onConflict: 'user_id,document,version', ignoreDuplicates: true });
  return { error: error?.message ?? null };
}
