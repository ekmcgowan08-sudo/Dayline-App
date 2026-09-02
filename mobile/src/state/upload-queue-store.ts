import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type QueuedClip = {
  clientCaptureId: string;
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
