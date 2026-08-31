/**
 * Which notification tap should deep-link where — pulled out of
 * services/notifications.ts as its own dependency-free module for the
 * same reason notificationDedup.ts was: that file transitively imports
 * lib/supabase.ts, which throws at import time without env vars (see
 * docs/TESTING.md), so anything worth unit-testing in isolation has to
 * live somewhere that doesn't drag that chain in.
 */
const MONTAGE_READY_TAG = 'dayline-day-ready';

export function getMontageIdFromNotificationData(data: Record<string, unknown> | undefined): string | null {
  if (data?.tag === MONTAGE_READY_TAG && typeof data.montageId === 'string' && data.montageId.length > 0) {
    return data.montageId;
  }
  return null;
}
