import { LEGAL_VERSIONS } from '../constants/legal';
import { supabase } from '../lib/supabase';

export async function recordAcceptance(userId: string): Promise<{ error: string | null }> {
  const rows = (Object.keys(LEGAL_VERSIONS) as (keyof typeof LEGAL_VERSIONS)[]).map((document) => ({
    user_id: userId,
    document,
    version: LEGAL_VERSIONS[document],
  }));
  const { error } = await supabase.from('acceptance_records').insert(rows);
  return { error: error?.message ?? null };
}
