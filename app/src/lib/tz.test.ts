import { describe, expect, it } from 'vitest';
import { addDaysToDateStr, dateStrInTz, hhmmInTz, monthDayOfDateStr, weekdayNameOfDateStr, weekdayOfDateStr, zonedMidnightUtc } from './tz';

describe('dateStrInTz', () => {
  it('reads the same instant as a different calendar date depending on the zone — the exact shape of the traveling-user bug', () => {
    // 2026-08-20T23:30:00Z is already 2026-08-21 in Europe/Berlin (UTC+2 in
    // August) but still 2026-08-20 in America/Los_Angeles (UTC-7).
    const instant = new Date('2026-08-20T23:30:00Z');
    expect(dateStrInTz(instant, 'Europe/Berlin')).toBe('2026-08-21');
    expect(dateStrInTz(instant, 'America/Los_Angeles')).toBe('2026-08-20');
  });
});

describe('hhmmInTz', () => {
  it('reads the same instant as a different wall-clock hour depending on the zone', () => {
    const instant = new Date('2026-08-20T14:00:00Z');
    expect(hhmmInTz(instant, 'Europe/Berlin')).toBe('16:00'); // UTC+2
    expect(hhmmInTz(instant, 'America/Los_Angeles')).toBe('07:00'); // UTC-7
  });
});

describe('zonedMidnightUtc', () => {
  it('round-trips through dateStrInTz in the same zone', () => {
    const midnight = zonedMidnightUtc('2026-08-21', 'Europe/Berlin');
    expect(dateStrInTz(midnight, 'Europe/Berlin')).toBe('2026-08-21');
    expect(hhmmInTz(midnight, 'Europe/Berlin')).toBe('00:00');
  });

  it('is a genuinely different UTC instant in two different zones for the same calendar date', () => {
    const berlinMidnight = zonedMidnightUtc('2026-08-21', 'Europe/Berlin');
    const laMidnight = zonedMidnightUtc('2026-08-21', 'America/Los_Angeles');
    expect(berlinMidnight.getTime()).not.toBe(laMidnight.getTime());
  });
});

describe('addDaysToDateStr', () => {
  it('adds and subtracts days, crossing month/year boundaries', () => {
    expect(addDaysToDateStr('2026-08-21', 1)).toBe('2026-08-22');
    expect(addDaysToDateStr('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToDateStr('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateStr('2026-08-21', -1)).toBe('2026-08-20');
    expect(addDaysToDateStr('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('weekdayOfDateStr', () => {
  it('is timezone-independent — a calendar date has one weekday regardless of zone', () => {
    // 2026-08-21 is a Friday.
    expect(weekdayOfDateStr('2026-08-21')).toBe(5);
  });
});

describe('weekdayNameOfDateStr', () => {
  it('formats the full and short weekday name', () => {
    expect(weekdayNameOfDateStr('2026-08-21')).toBe('Friday');
    expect(weekdayNameOfDateStr('2026-08-21', 'short')).toBe('Fri');
  });
});

describe('monthDayOfDateStr', () => {
  it('formats "Month Day"', () => {
    expect(monthDayOfDateStr('2026-08-22')).toBe('August 22');
  });
});
