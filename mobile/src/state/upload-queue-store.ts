import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type QueuedClip = {
  clientCaptureId: string;
  /** Whoever was signed in when this clip was captured. This queue is
   * device-global (AsyncStorage, not per-account), so on a shared/
   * borrowed device a clip captured by one user can still be sitting
   * here — queued or backed off after a failed attempt — when a
   * different user signs in on the same device. Every read/process of
   * this queue must filter by the CURRENT session's user id against
   * this field, or another user's not-yet-uploaded video gets silently
   * uploaded and attributed to whoever happens to be signed in (the
   * same "borrowed device" bug class the push-token fix closed for
   * device_push_tokens — see register_push_token()). */
  userId: string;
  localUri: string;
  durationMs: number;
  capturedAt: string; // ISO
  status: 'queued' | 'uploading' | 'failed' | 'permanently_failed' | 'done';
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null; // ISO — exponential backoff gate
};

type UploadQueueState = {
  items: QueuedClip[];
  enqueue: (item: Omit<QueuedClip, 'status' | 'retryCount' | 'lastError' | 'nextAttemptAt'>) => void;
  update: (clientCaptureId: string, patch: Partial<QueuedClip>) => void;
  remove: (clientCaptureId: string) => void;
};

export const useUploadQueueStore = create<UploadQueueState>()(
  persist(
    (set) => ({
      items: [],
      enqueue: (item) =>
        set((s) => ({
          items: [
            ...s.items.filter((i) => i.clientCaptureId !== item.clientCaptureId),
            { ...item, status: 'queued', retryCount: 0, lastError: null, nextAttemptAt: null },
          ],
        })),
      update: (clientCaptureId, patch) =>
        set((s) => ({
          items: s.items.map((i) => (i.clientCaptureId === clientCaptureId ? { ...i, ...patch } : i)),
        })),
      remove: (clientCaptureId) => set((s) => ({ items: s.items.filter((i) => i.clientCaptureId !== clientCaptureId) })),
    }),
    { name: 'dayline-upload-queue', storage: createJSONStorage(() => AsyncStorage) }
  )
);
