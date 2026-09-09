import { uploadLocalFile } from '../lib/storageUpload';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

export async function uploadAvatar(userId: string, localUri: string): Promise<{ url: string } | { error: string }> {
  const ext = localUri.split('.').pop()?.toLowerCase() || 'jpg';
  // A stable per-user path (not one timestamped per upload) so upsert:true
  // below actually overwrites the previous avatar object instead of
  // leaving it orphaned in storage forever — one leaked file per profile-
  // photo change, the same storage-leak class already fixed for montages
  // (see docs/IMPLEMENTATION_STATUS.md Phase 39). The public URL still
  // gets a `?t=` cache-buster appended so a changed photo doesn't keep
  // showing the previous one from any HTTP/CDN cache keyed on the URL.
  const path = `${userId}/avatar`;
  const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const { error } = await uploadLocalFile('avatars', path, localUri, contentType, true);
  if (error) return { error };
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: `${data.publicUrl}?t=${Date.now()}` };
}

export async function updateProfile(
  userId: string,
  fields: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'timezone'>>
) {
  const { error } = await supabase
    .from('profiles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', userId);
  return { error: error?.message ?? null };
}

export async function completeOnboarding(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', userId);
  return { error: error?.message ?? null };
}
