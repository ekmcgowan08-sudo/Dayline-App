import { writeFile } from 'node:fs/promises';
import { supabaseAdmin } from '../supabaseAdmin.js';

/** Downloads one clip from the private `clips` bucket using the service
 * role's server-side authorization (never a client's signed URL) and
 * writes it to a local path. */
export async function downloadClipToFile(storagePath: string, localPath: string): Promise<void> {
  const { data, error } = await supabaseAdmin.storage.from('clips').download(storagePath);
  if (error || !data) throw new Error(`download failed for ${storagePath}: ${error?.message ?? 'no data'}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  await writeFile(localPath, buffer);
}

export async function uploadMontageFile(storagePath: string, localPath: string): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(localPath);
  const { error } = await supabaseAdmin.storage
    .from('montages')
    .upload(storagePath, buffer, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error(`upload failed for ${storagePath}: ${error.message}`);
}
