import { supabase } from '../lib/supabase';
import type { Group, GroupMember } from '../types/database';

export type GroupWithRole = Group & { myRole: GroupMember['role']; memberCount: number };

export async function listMyGroups(userId: string): Promise<GroupWithRole[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('role, groups(*, group_members(count))')
    .eq('user_id', userId);
  if (error || !data) return [];
  return (data as unknown as { role: GroupMember['role']; groups: Group & { group_members: { count: number }[] } }[]).map(
    (row) => ({ ...row.groups, myRole: row.role, memberCount: row.groups.group_members?.[0]?.count ?? 1 })
  );
}

export async function createGroup(name: string): Promise<{ ok: true; group: Group } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('create_group', { p_name: name });
  if (error) return { ok: false, error: error.message };
  return { ok: true, group: data as Group };
}

const JOIN_ERROR_MESSAGES: Record<string, string> = {
  invalid_or_expired_code: "That code doesn't match an active group.",
  blocked_relationship: "You can't join this group.",
  group_full: 'This group already has its maximum of 10 members.',
  rate_limited: 'Too many attempts — try again in a few minutes.',
};

export async function joinGroupByCode(code: string): Promise<{ ok: true; group: Group } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('join_group_by_code', { p_code: code });
  if (error) return { ok: false, error: error.message };
  const result = data as { ok: boolean; group?: Group; error?: string };
  if (!result.ok) return { ok: false, error: JOIN_ERROR_MESSAGES[result.error ?? ''] ?? 'Could not join that group.' };
  return { ok: true, group: result.group! };
}

export type MemberWithProfile = GroupMember & { display_name: string | null; avatar_url: string | null };

export async function getGroupDetail(groupId: string): Promise<{ group: Group | null; members: MemberWithProfile[] }> {
  const [{ data: group }, { data: members }] = await Promise.all([
    supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
    supabase
      .from('group_members')
      .select('*, profiles(display_name, avatar_url)')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true }),
  ]);
  const mapped: MemberWithProfile[] = ((members ?? []) as unknown as (GroupMember & {
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  })[]).map((m) => ({ ...m, display_name: m.profiles?.display_name ?? null, avatar_url: m.profiles?.avatar_url ?? null }));
  return { group: (group as Group) ?? null, members: mapped };
}

export async function regenerateInviteCode(groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('regenerate_invite_code', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export async function revokeInviteCode(groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('revoke_invite_code', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export async function removeMember(groupId: string, targetUserId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('remove_group_member', { p_group_id: groupId, p_target_user_id: targetUserId });
  return { error: error?.message ?? null };
}

export async function leaveGroup(groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('leave_group', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export async function deleteGroup(groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('delete_group', { p_group_id: groupId });
  return { error: error?.message ?? null };
}

export async function contributeClipToGroup(clipId: string, groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('contribute_clip_to_group', { p_clip_id: clipId, p_group_id: groupId });
  return { error: error?.message ?? null };
}

export async function withdrawContribution(clipId: string, groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('group_contributions').delete().eq('clip_id', clipId).eq('group_id', groupId);
  return { error: error?.message ?? null };
}

/** Clip ids the current user has already contributed to this group (any date). */
export async function listMyContributedClipIds(groupId: string): Promise<Set<string>> {
  const { data } = await supabase.from('group_contributions').select('clip_id').eq('group_id', groupId);
  return new Set((data ?? []).map((r) => r.clip_id as string));
}
