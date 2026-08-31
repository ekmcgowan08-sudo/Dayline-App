import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { uploadLocalFile } from '../lib/storageUpload';
import { useUploadQueueStore, type QueuedClip } from '../state/upload-queue-store';
import type { Clip } from '../types/database';

/** Exponential backoff schedule for failed uploads, in seconds. */
const BACKOFF_SECONDS = [5, 15, 60, 300, 900];

const MAX_REASONABLE_CLIP_BYTES = 25 * 1024 * 1024; // basic sanity check, not a hard product limit

export function newClientCaptureId(): string {
  return Crypto.randomUUID();
}

/**
 * Adds a freshly recorded clip to the local pending-upload queue. The
 * clip's local file is never deleted until a confirmed successful upload
 * (see markUploaded), so a crash or force-quit mid-upload cannot lose it.
 */
export function enqueueClipForUpload(localUri: string, durationMs: number): string {
  const clientCaptureId = newClientCaptureId();
  useUploadQueueStore.getState().enqueue({
    clientCaptureId,
    localUri,
    durationMs,
    capturedAt: new Date().toISOString(),
  });
  return clientCaptureId;
}

async function validateLocalClip(localUri: string): Promise<{ error: string | null }> {
  const info = await FileSystem.getInfoAsync(localUri);
  if (!info.exists) return { error: 'Recorded file is missing' };
  if ('size' in info && info.size !== undefined) {
    if (info.size === 0) return { error: 'Recorded file is empty' };
    if (info.size > MAX_REASONABLE_CLIP_BYTES) return { error: 'Recorded file is unexpectedly large' };
  }
  return { error: null };
}

/** Uploads one queued clip. Idempotent: reusing the same clientCaptureId on
 * retry upserts the same clips row via the unique (user_id, client_capture_id)
 * index instead of creating a duplicate. */
async function uploadOne(userId: string, item: QueuedClip): Promise<{ error: string | null }> {
  const { error: validationError } = await validateLocalClip(item.localUri);
  if (validationError) return { error: validationError };

  const storagePath = `${userId}/${item.clientCaptureId}.mp4`;
  const { error: uploadError } = await uploadLocalFile('clips', storagePath, item.localUri, 'video/mp4', true);
  if (uploadError) return { error: uploadError };

  const { error: dbError } = await supabase.from('clips').upsert(
    {
      user_id: userId,
      storage_path: storagePath,
      duration_ms: item.durationMs,
      captured_at: item.capturedAt,
      client_capture_id: item.clientCaptureId,
      status: 'uploaded',
    },
    { onConflict: 'user_id,client_capture_id' }
  );
  if (dbError) return { error: dbError.message };

  await matchClipToNearestSlot(userId, item.clientCaptureId, item.capturedAt);
  return { error: null };
}

/** Best-effort: marks the capture_slot closest in time to this clip as
 * completed, so the Today timeline reflects it. Not finding a slot (e.g.
 * a manual off-schedule capture) is not an error. */
async function matchClipToNearestSlot(userId: string, clientCaptureId: string, capturedAtISO: string) {
  const { data: clip } = await supabase
    .from('clips')
    .select('id')
    .eq('user_id', userId)
    .eq('client_capture_id', clientCaptureId)
    .maybeSingle();
  if (!clip) return;

  const capturedAt = new Date(capturedAtISO);
  const dayStart = new Date(capturedAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(capturedAt);
  dayEnd.setHours(23, 59, 59, 999);

  const { data: slots } = await supabase
    .from('capture_slots')
    .select('id, scheduled_at, status')
    .eq('user_id', userId)
    .gte('scheduled_at', dayStart.toISOString())
    .lte('scheduled_at', dayEnd.toISOString())
    .eq('status', 'pending');

  if (!slots || slots.length === 0) return;

  let closest = slots[0];
  let closestDiff = Math.abs(new Date(slots[0].scheduled_at).getTime() - capturedAt.getTime());
  for (const s of slots.slice(1)) {
    const diff = Math.abs(new Date(s.scheduled_at).getTime() - capturedAt.getTime());
    if (diff < closestDiff) {
      closest = s;
      closestDiff = diff;
    }
  }
  // Only claim a slot within a generous 3-hour window either side; otherwise
  // this was a manual off-schedule capture and no slot should be marked.
  if (closestDiff <= 3 * 60 * 60 * 1000) {
    await supabase.from('capture_slots').update({ status: 'completed', clip_id: clip.id }).eq('id', closest.id);
  }
}

/** Processes every queued/failed item whose backoff window has elapsed.
 * Call this on app foreground and after any manual "retry" action. */
export async function processUploadQueue(userId: string): Promise<void> {
  const store = useUploadQueueStore.getState();
  const now = Date.now();
  const due = store.items.filter(
    (i) => (i.status === 'queued' || i.status === 'failed') && (!i.nextAttemptAt || new Date(i.nextAttemptAt).getTime() <= now)
  );

  for (const item of due) {
    store.update(item.clientCaptureId, { status: 'uploading' });
    const { error } = await uploadOne(userId, item);
    if (error) {
      const retryCount = item.retryCount + 1;
      const delaySec = BACKOFF_SECONDS[Math.min(retryCount - 1, BACKOFF_SECONDS.length - 1)];
      store.update(item.clientCaptureId, {
        status: 'failed',
        retryCount,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + delaySec * 1000).toISOString(),
      });
    } else {
      store.update(item.clientCaptureId, { status: 'done' });
      // Local file can now be safely removed; keep the queue entry briefly
      // (status 'done') so the UI can show a success state, then drop it.
      await FileSystem.deleteAsync(item.localUri, { idempotent: true }).catch(() => {});
      setTimeout(() => useUploadQueueStore.getState().remove(item.clientCaptureId), 3000);
    }
  }
}

export async function listTodaysClips(userId: string, dayStartISO: string, dayEndISO: string): Promise<Clip[]> {
  const { data } = await supabase
    .from('clips')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('captured_at', dayStartISO)
    .lte('captured_at', dayEndISO)
    .order('captured_at', { ascending: true });
  return (data as Clip[]) ?? [];
}

export async function getSignedClipUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('clips').createSignedUrl(storagePath, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteClip(clipId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('delete_own_clip', { p_clip_id: clipId });
  return { error: error?.message ?? null };
}
