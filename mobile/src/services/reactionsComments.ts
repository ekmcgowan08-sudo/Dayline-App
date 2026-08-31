import { supabase } from '../lib/supabase';
import type { Comment, Reaction, ReactionEmoji } from '../types/database';

export const REACTION_EMOJIS: ReactionEmoji[] = ['❤️', '😂', '😮', '🥹', '🙌', '🔥'];

export type CommentWithAuthor = Comment & { display_name: string | null; avatar_url: string | null };

export async function listReactions(montageId: string): Promise<Reaction[]> {
  const { data } = await supabase.from('reactions').select('*').eq('montage_id', montageId);
  return (data as Reaction[]) ?? [];
}

export async function toggleReaction(montageId: string, userId: string, emoji: ReactionEmoji): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from('reactions')
    .select('id')
    .eq('montage_id', montageId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('reactions').delete().eq('id', existing.id);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.from('reactions').insert({ montage_id: montageId, user_id: userId, emoji });
  return { error: error?.message ?? null };
}

export async function listComments(montageId: string): Promise<CommentWithAuthor[]> {
  const { data } = await supabase
    .from('comments')
    .select('*, profiles(display_name, avatar_url)')
    .eq('montage_id', montageId)
    .order('created_at', { ascending: true });
  return ((data ?? []) as unknown as (Comment & { profiles: { display_name: string | null; avatar_url: string | null } | null })[]).map(
    (c) => ({ ...c, display_name: c.profiles?.display_name ?? null, avatar_url: c.profiles?.avatar_url ?? null })
  );
}

const MAX_COMMENT_LENGTH = 500;

export async function postComment(montageId: string, userId: string, body: string): Promise<{ error: string | null }> {
  const trimmed = body.trim();
  if (!trimmed) return { error: 'Comment cannot be empty' };
  if (trimmed.length > MAX_COMMENT_LENGTH) return { error: `Comments are limited to ${MAX_COMMENT_LENGTH} characters` };
  const { error } = await supabase.from('comments').insert({ montage_id: montageId, user_id: userId, body: trimmed });
  return { error: error?.message ?? null };
}

export async function deleteOwnComment(commentId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  return { error: error?.message ?? null };
}

export async function moderateDeleteComment(commentId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('moderate_delete_comment', { p_comment_id: commentId });
  return { error: error?.message ?? null };
}
