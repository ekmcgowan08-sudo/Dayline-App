import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

/** Shared local-file → Supabase Storage upload helper (avatars, clips, ...). */
export async function uploadLocalFile(
  bucket: string,
  path: string,
  localUri: string,
  contentType: string,
  upsert = false
): Promise<{ error: string | null }> {
  try {
    const info = await FileSystem.getInfoAsync(localUri);
    if (!info.exists) return { error: 'Local file is missing' };

    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
    const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), { contentType, upsert });
    return { error: error?.message ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Upload failed' };
  }
}
