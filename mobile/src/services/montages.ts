import { supabase } from '../lib/supabase';
import type { Montage } from '../types/database';

export type RequestMontageParams = { scope: 'personal' } | { scope: 'group'; groupId: string; date?: string };

export type RequestMontageResult =
  | { ok: true; montageId: string; status: Montage['status'] }
  | { ok: false; error: string };

export async function requestMontage(params: RequestMontageParams): Promise<RequestMontageResult> {
  const { data, error } = await supabase.functions.invoke('request-montage', {
    body: params.scope === 'personal' ? { scope: 'personal' } : { scope: 'group', groupId: params.groupId, date: params.date },
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'unknown_error' };
  return { ok: true, montageId: data.montageId, status: data.status };
}

export async function getMontage(montageId: string): Promise<Montage | null> {
  const { data } = await supabase.from('montages').select('*').eq('id', montageId).maybeSingle();
  return (data as Montage) ?? null;
}

export type MontageUrlResult =
  | { ok: true; status: 'ready'; url: string }
  | { ok: true; status: Exclude<Montage['status'], 'ready'>; errorCode: string | null }
  | { ok: false; error: string };

export async function getMontagePlaybackUrl(montageId: string): Promise<MontageUrlResult> {
  const { data, error } = await supabase.functions.invoke('get-montage-url', { body: { montageId } });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'unknown_error' };
  if (data.status === 'ready') return { ok: true, status: 'ready', url: data.url };
  return { ok: true, status: data.status, errorCode: data.errorCode ?? null };
}

/** Subscribes to realtime status changes for one montage row. Falls back to
 * polling is not implemented client-side — Supabase Realtime (Postgres
 * changes) is used directly since it's already part of the platform. */
export function subscribeToMontage(montageId: string, onChange: (montage: Montage) => void) {
  const channel = supabase
    .channel(`montage-${montageId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'montages', filter: `id=eq.${montageId}` },
      (payload) => onChange(payload.new as Montage)
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function listPersonalMontages(userId: string): Promise<Montage[]> {
  const { data } = await supabase
    .from('montages')
    .select('*')
    .eq('user_id', userId)
    .order('session_date', { ascending: false });
  return (data as Montage[]) ?? [];
}
