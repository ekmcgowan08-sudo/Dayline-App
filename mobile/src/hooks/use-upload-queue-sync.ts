import { useEffect } from 'react';
import { AppState } from 'react-native';
import { processUploadQueue } from '../services/clips';
import { useUploadQueueStore } from '../state/upload-queue-store';

/**
 * Drives the upload queue while the app is foregrounded: an immediate pass
 * on mount/foreground, then a periodic sweep so backoff-delayed retries
 * actually fire without the user having to background/foreground the app.
 * There is no background task here (Expo's background task APIs are not
 * reliable enough in a bare/managed workflow to promise delivery) — this
 * is a documented scope limitation, see docs/IMPLEMENTATION_STATUS.md.
 */
export function useUploadQueueSync(userId: string | undefined) {
  const pendingCount = useUploadQueueStore((s) => s.items.filter((i) => i.status !== 'done').length);

  useEffect(() => {
    if (!userId) return;
    processUploadQueue(userId);

    const interval = setInterval(() => processUploadQueue(userId), 20_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') processUploadQueue(userId);
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [userId]);

  return { pendingCount };
}
