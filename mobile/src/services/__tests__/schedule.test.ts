import { computeSlotTimesForDate, dayOfWeekForDate, type CaptureSchedule } from '../schedule';

const base: CaptureSchedule = {
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  wakeHour: 8,
  sleepHour: 9,
  mode: 'hourly',
  remindersPerDay: 8,
  customTimes: [],
  quietStart: null,
  quietEnd: null,
  timezone: 'America/New_York',
  pausedUntilDate: null,
};

describe('dayOfWeekForDate', () => {
  it('is timezone-independent and matches the literal calendar date', () => {
    // 2026-08-31 is a Monday.
    expect(dayOfWeekForDate('2026-08-31')).toBe(1);
    // 2026-01-01 is a Thursday.
    expect(dayOfWeekForDate('2026-01-01')).toBe(4);
  });
});

describe('computeSlotTimesForDate', () => {
  it('converts an 8am local wall-clock slot to the correct UTC instant across a DST boundary', () => {
    // America/New_York is UTC-5 (EST) in January, UTC-4 (EDT) in July.
    const winterSlots = computeSlotTimesForDate(base, '2026-01-15');
    const summerSlots = computeSlotTimesForDate(base, '2026-07-15');

    expect(winterSlots[0].toISOString()).toBe('2026-01-15T13:00:00.000Z'); // 8am EST
    expect(summerSlots[0].toISOString()).toBe('2026-07-15T12:00:00.000Z'); // 8am EDT
  });

  it('returns no slots on a day outside activeDays', () => {
    const mondayOnly: CaptureSchedule = { ...base, activeDays: [1] };
    // 2026-08-30 is a Sunday.
    expect(computeSlotTimesForDate(mondayOnly, '2026-08-30')).toHaveLength(0);
    // 2026-08-31 is a Monday.
    expect(computeSlotTimesForDate(mondayOnly, '2026-08-31').length).toBeGreaterThan(0);
  });

  it('returns no slots while paused', () => {
    const paused: CaptureSchedule = { ...base, pausedUntilDate: '2026-09-30' };
    expect(computeSlotTimesForDate(paused, '2026-09-15')).toHaveLength(0);
    expect(computeSlotTimesForDate(paused, '2026-10-01').length).toBeGreaterThan(0);
  });

  it('filters out slots inside quiet hours, including a window that wraps midnight', () => {
    const wideWindow: CaptureSchedule = {
      ...base,
      wakeHour: 0,
      sleepHour: 23,
      mode: 'hourly',
      quietStart: 22,
      quietEnd: 6, // wraps midnight: quiet from 10pm to 6am
    };
    const slots = wideWindow ? computeSlotTimesForDate(wideWindow, '2026-06-15') : [];
    const localHours = slots.map((d) =>
      Number(
        new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: base.timezone }).format(d)
      )
    );
    expect(localHours.every((h) => h >= 6 && h < 22)).toBe(true);
  });

  it('uses explicit HH:mm times for custom mode, ignoring wake/sleep hour', () => {
    const custom: CaptureSchedule = { ...base, mode: 'custom', customTimes: ['09:15', '13:00', '21:45'] };
    const slots = computeSlotTimesForDate(custom, '2026-01-15');
    expect(slots).toHaveLength(3);
    expect(slots[0].toISOString()).toBe('2026-01-15T14:15:00.000Z'); // 9:15am EST
    expect(slots[2].toISOString()).toBe('2026-01-16T02:45:00.000Z'); // 9:45pm EST
  });

  it('produces an empty window when sleepHour is not after wakeHour', () => {
    const inverted: CaptureSchedule = { ...base, wakeHour: 20, sleepHour: 8 };
    expect(computeSlotTimesForDate(inverted, '2026-08-31')).toHaveLength(0);
  });
});
