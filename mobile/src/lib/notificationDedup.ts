import AsyncStorage from '@react-native-async-storage/async-storage';

const SHOWN_SLOTS_KEY = 'dayline-shown-capture-slot-notifications';

/**
 * Local ↔ server duplicate suppression for capture reminders. Both the
 * client's own scheduled local notification and the send-capture-
 * reminders Edge Function's push carry the same `data.captureSlotId`.
 * Neither platform hands back a delivery receipt for a local
 * notification, so this can't guarantee zero duplicates (documented in
 * supabase/functions/send-capture-reminders/index.ts) — but whichever one
 * a device sees *first* for a given slot wins, and the second is
 * suppressed rather than shown twice.
 *
 * Deliberately has no other imports (not even the Supabase client) so it
 * can be unit-tested without any environment/network setup.
 */
export async function alreadyShown(captureSlotId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(SHOWN_SLOTS_KEY);
    const shown: string[] = raw ? JSON.parse(raw) : [];
    return shown.includes(captureSlotId);
  } catch {
    return false;
  }
}

export async function markShown(captureSlotId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SHOWN_SLOTS_KEY);
    const shown: string[] = raw ? JSON.parse(raw) : [];
    // Keep this bounded — a capture slot is only ever relevant for a
    // single day, so the last 100 ids is a generous cap regardless of
    // schedule frequency.
    const next = [...shown, captureSlotId].slice(-100);
    await AsyncStorage.setItem(SHOWN_SLOTS_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal: worst case a duplicate shows once in a while.
  }
}
