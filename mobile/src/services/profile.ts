import { uploadLocalFile } from '../lib/storageUpload';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

export async function uploadAvatar(userId: string, localUri: string): Promise<{ url: string } | { error: string }> {
  const ext = localUri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const { error } = await uploadLocalFile('avatars', path, localUri, contentType, true);
  if (error) return { error };
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: data.publicUrl };
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
