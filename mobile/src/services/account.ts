import { supabase } from '../lib/supabase';

export async function requestDataExport(): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('request_data_export');
  return { error: error?.message ?? null };
}

export async function requestAccountDeletion(): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('request_account_deletion');
  return { error: error?.message ?? null };
}

/** Actually performs the deletion (storage + auth user + cascades) via the
 * delete-account Edge Function. Call requestAccountDeletion() first to
 * record intent, then this to carry it out — see docs/PRIVACY_DATA_FLOW.md
 * for why this build deletes immediately rather than after a grace period. */
export async function confirmAccountDeletion(): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) return { error: error.message };
  if (!data?.ok) return { error: data?.error ?? 'unknown_error' };
  return { error: null };
}

export async function updateMemoryNotifications(userId: string, enabled: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('notification_preferences')
    .update({ memory_notifications: enabled, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { error: error?.message ?? null };
}

export async function updateTranscriptionConsent(userId: string, consented: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('transcription_consents')
    .upsert({ user_id: userId, consented, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}

export async function getTranscriptionConsent(userId: string): Promise<boolean> {
  const { data } = await supabase.from('transcription_consents').select('consented').eq('user_id', userId).maybeSingle();
  return data?.consented ?? false;
}
