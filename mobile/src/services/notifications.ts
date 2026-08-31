import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { alreadyShown, markShown } from '../lib/notificationDedup';
import { supabase } from '../lib/supabase';
import { computeSlotTimesForDate, todayISOInTimeZone, type CaptureSchedule } from './schedule';

/** A stable tag so we can identify (and cancel) exactly our capture-reminder
 * notifications without touching any other local notifications the app
 * might schedule later (e.g. memory resurfacing). */
const CAPTURE_REMINDER_TAG = 'dayline-capture-reminder';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const captureSlotId = notification.request.content.data?.captureSlotId as string | undefined;
    if (captureSlotId) {
      if (await alreadyShown(captureSlotId)) {
        return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
      }
      await markShown(captureSlotId);
    }
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getNotificationPermissionStatus() {
  return Notifications.getPermissionsAsync();
}

/**
 * Registers this device for server-push (Expo push token → device_push_tokens).
 * Failure here (no EAS project configured yet, simulator without push
 * capability, permission denied) is non-fatal — local notifications still
 * work standalone; this only adds the server-side backup delivery path.
 */
export async function registerPushToken(userId: string): Promise<{ error: string | null }> {
  try {
    if (!Device.isDevice) return { error: 'push tokens require a physical device' };
    const granted = await requestNotificationPermission();
    if (!granted) return { error: 'notification permission not granted' };

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    const { error } = await supabase.from('device_push_tokens').upsert(
      {
        user_id: userId,
        expo_push_token: expoPushToken,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' }
    );
    return { error: error?.message ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'push registration failed' };
  }
}

/**
 * (Re)schedules today's local capture-reminder notifications and mirrors
 * the same slot times into `capture_slots` (idempotent upsert keyed on
 * (user_id, scheduled_at)) so the Today timeline has a durable, server-
 * visible record of what was planned — independent of whether the local
 * notification actually survives an app kill/reinstall. Returns the
 * number of future slots scheduled.
 */
export async function syncTodaysCaptureSlots(
  userId: string,
  schedule: CaptureSchedule
): Promise<{ scheduledCount: number; error: string | null }> {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((n) => n.content.data?.tag === CAPTURE_REMINDER_TAG)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );

  const todayISO = todayISOInTimeZone(schedule.timezone);
  const allSlots = computeSlotTimesForDate(schedule, todayISO);

  const { error: upsertError } = await supabase.from('capture_slots').upsert(
    allSlots.map((slot) => ({ user_id: userId, slot_date: todayISO, scheduled_at: slot.toISOString() })),
    { onConflict: 'user_id,scheduled_at', ignoreDuplicates: true }
  );

  const now = Date.now();
  const futureSlots = allSlots.filter((slot) => slot.getTime() > now);

  // Look up each slot's row id (including ones that already existed from
  // an earlier sync today) so the local notification can carry the same
  // captureSlotId the server-push backup uses for duplicate suppression.
  const { data: slotRows } = await supabase
    .from('capture_slots')
    .select('id, scheduled_at')
    .eq('user_id', userId)
    .eq('slot_date', todayISO);
  const slotIdByTime = new Map((slotRows ?? []).map((r) => [r.scheduled_at, r.id as string]));

  for (const slot of futureSlots) {
    const captureSlotId = slotIdByTime.get(slot.toISOString());
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Capture this moment',
        body: 'Five seconds of right now — whatever it is.',
        data: { tag: CAPTURE_REMINDER_TAG, ...(captureSlotId ? { captureSlotId } : {}) },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: slot },
    });
  }

  return { scheduledCount: futureSlots.length, error: upsertError?.message ?? null };
}

export async function cancelAllCaptureReminders(): Promise<void> {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((n) => n.content.data?.tag === CAPTURE_REMINDER_TAG)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}
