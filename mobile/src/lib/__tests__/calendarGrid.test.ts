import { buildMonthGrid, shiftMonth } from '../calendarGrid';

describe('buildMonthGrid', () => {
  it('produces the correct number of real (non-null) days for a 31-day month', () => {
    const weeks = buildMonthGrid(2026, 8); // August has 31 days
    const realDays = weeks.flat().filter((c) => c !== null);
    expect(realDays.length).toBe(31);
  });

  it('produces the correct number of real days for February in a non-leap year', () => {
    const weeks = buildMonthGrid(2026, 2); // 2026 is not a leap year
    const realDays = weeks.flat().filter((c) => c !== null);
    expect(realDays.length).toBe(28);
  });

  it('handles February in a leap year', () => {
    const weeks = buildMonthGrid(2028, 2);
    const realDays = weeks.flat().filter((c) => c !== null);
    expect(realDays.length).toBe(29);
  });

  it('every week has exactly 7 cells', () => {
    const weeks = buildMonthGrid(2026, 8);
    for (const week of weeks) expect(week.length).toBe(7);
  });

  it('the first real day lands on the correct weekday column', () => {
    const year = 2026;
    const month = 8;
    const weeks = buildMonthGrid(year, month);
    const expectedWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const firstRealIndex = weeks[0].findIndex((c) => c !== null);
    expect(firstRealIndex).toBe(expectedWeekday);
  });

  it('produces dates in YYYY-MM-DD form, in order', () => {
    const weeks = buildMonthGrid(2026, 8);
    const dates = weeks.flat().filter((c): c is { date: string } => c !== null).map((c) => c.date);
    expect(dates[0]).toBe('2026-08-01');
    expect(dates[dates.length - 1]).toBe('2026-08-31');
    expect(dates).toEqual([...dates].sort());
  });
});

describe('shiftMonth', () => {
  it('moves forward within the same year', () => {
    expect(shiftMonth(2026, 8, 1)).toEqual({ year: 2026, month: 9 });
  });

  it('moves backward within the same year', () => {
    expect(shiftMonth(2026, 8, -1)).toEqual({ year: 2026, month: 7 });
  });

  it('rolls over into the next year', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('rolls back into the previous year', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('handles a multi-month jump', () => {
    expect(shiftMonth(2026, 1, 13)).toEqual({ year: 2027, month: 2 });
  });
});
