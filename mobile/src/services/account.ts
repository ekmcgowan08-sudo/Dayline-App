import { supabase } from '../lib/supabase';
import type { DataExportRequest } from '../types/database';

export async function requestDataExport(): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('request_data_export');
  return { error: error?.message ?? null };
}

/** The most recent export request this user has made, if any — used to
 * show its status (pending/fulfilled) and offer a download once it's
 * ready. `request_data_export()` itself dedupes pending requests, so
 * "most recent" is enough; there's never more than one pending at a time. */
export async function getLatestExportRequest(userId: string): Promise<DataExportRequest | null> {
  const { data } = await supabase
    .from('data_export_requests')
    .select('*')
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DataExportRequest) ?? null;
}

/** Fetches a short-lived signed URL for a fulfilled export via the
 * get-export-url Edge Function — the client's own session can never read
 * the private `exports` bucket directly (see
 * supabase/migrations/20260831210000_data_export_fulfillment.sql). */
export async function getExportDownloadUrl(requestId: string): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('get-export-url', { body: { requestId } });
  if (error) return { url: null, error: error.message };
  if (!data?.ok) return { url: null, error: data?.error ?? 'unknown_error' };
  if (data.status !== 'fulfilled' || !data.url) return { url: null, error: null };
  return { url: data.url as string, error: null };
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

export async function updateMontageReadyNotifications(userId: string, enabled: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('notification_preferences')
    .update({ montage_ready_notifications: enabled, updated_at: new Date().toISOString() })
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
