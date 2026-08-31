import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { CaptureMode } from '../types/database';

export type CaptureSchedule = {
  /** 0=Sunday..6=Saturday, matching Date#getDay(). */
  activeDays: number[];
  wakeHour: number; // 0-23, local wall clock
  sleepHour: number; // 0-23, local wall clock, exclusive-ish end of window
  mode: CaptureMode;
  remindersPerDay: number; // used for 'randomized'
  /** "HH:mm" 24h local wall-clock times, used when mode === 'custom'. */
  customTimes: string[];
  quietStart: number | null; // 0-23
  quietEnd: number | null; // 0-23
  /** IANA zone, e.g. "America/Chicago". Slot times are computed as wall-clock
   * times *in this zone*, then converted to UTC instants — this is what
   * makes scheduling correct across DST transitions: the same 8:00 AM local
   * slot lands on a different UTC instant on either side of a DST change,
   * exactly as it should for a human reading a clock. */
  timezone: string;
  /** If set and >= today (in `timezone`), no slots are generated — this is "pause". */
  pausedUntilDate: string | null; // YYYY-MM-DD
};

export const DEFAULT_SCHEDULE: Omit<CaptureSchedule, 'timezone'> = {
  // Matches the recovered PRD's example default: 8am-11pm, ~8 reminders/day.
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  wakeHour: 8,
  sleepHour: 23,
  mode: 'randomized',
  remindersPerDay: 8,
  customTimes: [],
  quietStart: null,
  quietEnd: null,
  pausedUntilDate: null,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar day-of-week for a YYYY-MM-DD string, independent of runtime timezone. */
export function dayOfWeekForDate(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function todayISOInTimeZone(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
}

/**
 * Computes the concrete UTC instants for a schedule on a given local
 * calendar date. Returns instants already in the past relative to `now`
 * unfiltered — callers filter those out when actually scheduling
 * notifications (a completed slot for 9am is still meaningful for the
 * Today timeline's history even after 9am has passed).
 */
export function computeSlotTimesForDate(schedule: CaptureSchedule, dateISO: string): Date[] {
  if (!schedule.activeDays.includes(dayOfWeekForDate(dateISO))) return [];
  if (schedule.pausedUntilDate && dateISO <= schedule.pausedUntilDate) return [];

  if (schedule.mode === 'custom') {
    return schedule.customTimes
      .filter((hhmm) => /^\d{2}:\d{2}$/.test(hhmm))
      .map((hhmm) => fromZonedTime(`${dateISO}T${hhmm}:00`, schedule.timezone))
      .sort((a, b) => a.getTime() - b.getTime());
  }

  const start = fromZonedTime(`${dateISO}T${pad(schedule.wakeHour)}:00:00`, schedule.timezone);
  const end = fromZonedTime(`${dateISO}T${pad(schedule.sleepHour)}:00:00`, schedule.timezone);
  if (end.getTime() <= start.getTime()) return [];

  let times: Date[] = [];
  if (schedule.mode === 'hourly') {
    for (let t = start.getTime(); t <= end.getTime(); t += 60 * 60 * 1000) times.push(new Date(t));
  } else {
    const count = Math.max(1, schedule.remindersPerDay);
    const spanMs = end.getTime() - start.getTime();
    for (let i = 0; i < count; i++) {
      const jitter = Math.random() * (spanMs / count);
      times.push(new Date(start.getTime() + (spanMs / count) * i + jitter));
    }
  }

  if (schedule.quietStart != null && schedule.quietEnd != null) {
    const qs = schedule.quietStart;
    const qe = schedule.quietEnd;
    times = times.filter((t) => {
      const localHour = Number(formatInTimeZone(t, schedule.timezone, 'H'));
      return qs < qe ? !(localHour >= qs && localHour < qe) : !(localHour >= qs || localHour < qe);
    });
  }

  return times.sort((a, b) => a.getTime() - b.getTime());
}
