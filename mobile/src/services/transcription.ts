import { supabase } from '../lib/supabase';

export async function requestTranscription(clipId: string): Promise<{ ok: true; caption: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke('transcribe', { body: { clipId } });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'unknown_error' };
  return { ok: true, caption: data.caption };
}

export async function getMostRecentClipId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('clips')
    .select('id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
