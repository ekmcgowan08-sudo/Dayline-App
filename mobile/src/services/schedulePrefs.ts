import { supabase } from '../lib/supabase';
import type { NotificationPreferences } from '../types/database';
import { DEFAULT_SCHEDULE, type CaptureSchedule } from './schedule';

export function prefsToSchedule(prefs: NotificationPreferences, timezone: string): CaptureSchedule {
  return {
    activeDays: prefs.active_days,
    wakeHour: prefs.wake_hour,
    sleepHour: prefs.sleep_hour,
    mode: prefs.mode,
    remindersPerDay: prefs.reminders_per_day,
    customTimes: prefs.custom_times,
    quietStart: prefs.quiet_start,
    quietEnd: prefs.quiet_end,
    timezone,
    pausedUntilDate: prefs.paused_until,
  };
}

export async function loadSchedulePrefs(userId: string, timezone: string): Promise<CaptureSchedule> {
  const { data } = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return { ...DEFAULT_SCHEDULE, timezone };
  return prefsToSchedule(data as NotificationPreferences, timezone);
}

export async function saveSchedulePrefs(
  userId: string,
  schedule: Omit<CaptureSchedule, 'timezone'>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('notification_preferences').upsert({
    user_id: userId,
    active_days: schedule.activeDays,
    wake_hour: schedule.wakeHour,
    sleep_hour: schedule.sleepHour,
    mode: schedule.mode,
    reminders_per_day: schedule.remindersPerDay,
    custom_times: schedule.customTimes,
    quiet_start: schedule.quietStart,
    quiet_end: schedule.quietEnd,
    paused_until: schedule.pausedUntilDate,
    updated_at: new Date().toISOString(),
  });
  return { error: error?.message ?? null };
}

export async function pauseCapture(userId: string, untilDate: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('notification_preferences')
    .update({ paused_until: untilDate, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { error: error?.message ?? null };
}
