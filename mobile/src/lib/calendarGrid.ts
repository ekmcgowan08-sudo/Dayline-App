/**
 * Pure month-grid math for the Memories calendar view — separately
 * testable from the component that renders it, same pattern as
 * schedule.ts's slot-time math.
 */
export type CalendarCell = { date: string } | null; // date is YYYY-MM-DD, null = padding outside the month

/** Sunday-first month grid: an array of 7-cell weeks, with `null` padding
 * for days outside the given month so every week lines up under the same
 * weekday header. `month` is 1-12. */
export function buildMonthGrid(year: number, month: number): CalendarCell[][] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = firstOfMonth.getUTCDay(); // 0 = Sunday

  const cells: CalendarCell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** { year, month } for the month `offset` months away from the given one
 * (negative = earlier). Used for the calendar's prev/next navigation. */
export function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const zeroBased = (year * 12 + (month - 1)) + offset;
  return { year: Math.floor(zeroBased / 12), month: (((zeroBased % 12) + 12) % 12) + 1 };
}
