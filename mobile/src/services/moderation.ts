import { supabase } from '../lib/supabase';
import type { ReportTargetType } from '../types/database';

export async function reportContent(
  targetType: ReportTargetType,
  targetId: string,
  reason: string
): Promise<{ error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('reports')
    .insert({ reporter_id: userData.user.id, target_type: targetType, target_id: targetId, reason });
  return { error: error?.message ?? null };
}

export async function blockUser(blockedId: string): Promise<{ error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'Not signed in' };
  const { error } = await supabase.from('blocks').insert({ blocker_id: userData.user.id, blocked_id: blockedId });
  return { error: error?.message ?? null };
}

export async function unblockUser(blockedId: string): Promise<{ error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'Not signed in' };
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', userData.user.id).eq('blocked_id', blockedId);
  return { error: error?.message ?? null };
}

export async function listBlockedUsers(): Promise<{ blocked_id: string; display_name: string | null }[]> {
  const { data } = await supabase.from('blocks').select('blocked_id, profiles(display_name)');
  return ((data ?? []) as unknown as { blocked_id: string; profiles: { display_name: string | null } | null }[]).map((r) => ({
    blocked_id: r.blocked_id,
    display_name: r.profiles?.display_name ?? null,
  }));
}
