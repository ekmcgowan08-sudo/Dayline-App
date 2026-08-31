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

/** Goes through list_my_personal_montages() rather than a direct table
 * select — that RPC is what actually enforces
 * ENTITLEMENT_LIMITS.free.memoryArchiveDays server-side (see
 * supabase/migrations/20260831180000_entitlement_enforced_archive.sql).
 * A raw client-side select would return every montage regardless of tier;
 * RLS alone doesn't limit by date/entitlement, only by ownership. */
export async function listPersonalMontages(): Promise<Montage[]> {
  const { data, error } = await supabase.rpc('list_my_personal_montages');
  if (error) return [];
  return (data as Montage[]) ?? [];
}

export type GroupMontage = Montage & { group_name: string };

/** Same entitlement-enforcement reasoning as listPersonalMontages — goes
 * through list_my_group_montages() rather than a direct select. Group
 * names are joined in a second, small query (the RPC's return type is
 * fixed to plain `montages` rows) rather than exposed by the RPC itself. */
export async function listGroupMontages(): Promise<GroupMontage[]> {
  const { data: montages, error } = await supabase.rpc('list_my_group_montages');
  if (error || !montages || montages.length === 0) return [];

  const groupIds = [...new Set((montages as Montage[]).map((m) => m.group_id).filter((id): id is string => Boolean(id)))];
  const { data: groups } = await supabase.from('groups').select('id, name').in('id', groupIds);
  const nameById = new Map((groups ?? []).map((g) => [g.id, g.name as string]));

  return (montages as Montage[]).map((m) => ({ ...m, group_name: (m.group_id && nameById.get(m.group_id)) ?? 'Group' }));
}

/** "On this day": ready personal montages from exactly 7/30/365 days ago. */
export async function getMemoriesOnThisDay(): Promise<Montage[]> {
  const { data, error } = await supabase.rpc('memories_on_this_day');
  if (error) return [];
  return (data as Montage[]) ?? [];
}

export async function deletePersonalMontage(montageId: string): Promise<{ error: string | null }> {
  // Same pattern as deleteClip: read the storage path before the row is
  // gone so the rendered video is actually removed, not just the row.
  const { data: montage } = await supabase.from('montages').select('storage_path').eq('id', montageId).maybeSingle();

  const { error } = await supabase.rpc('delete_own_personal_montage', { p_montage_id: montageId });
  if (error) return { error: error.message };

  if (montage?.storage_path) {
    await supabase.storage.from('montages').remove([montage.storage_path]);
  }
  return { error: null };
}
