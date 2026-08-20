import { describe, expect, it } from 'vitest';
import { fmtElapsed, fmtHours } from './format';

describe('fmtHours', () => {
  it('formats whole numbers with no decimal', () => {
    expect(fmtHours(4)).toBe('4h');
    expect(fmtHours(0)).toBe('0h');
    expect(fmtHours(10)).toBe('10h');
  });

  it('formats half hours with one decimal', () => {
    expect(fmtHours(0.5)).toBe('0.5h');
    expect(fmtHours(1.5)).toBe('1.5h');
    expect(fmtHours(4.5)).toBe('4.5h');
  });

  it('rounds to the nearest 0.1h', () => {
    expect(fmtHours(4.04)).toBe('4h'); // rounds down to 4.0
    expect(fmtHours(4.06)).toBe('4.1h'); // rounds up to 4.1
  });

  it('drops the decimal once rounding lands back on a whole number', () => {
    expect(fmtHours(3.96)).toBe('4h');
  });
});

describe('fmtElapsed', () => {
  it('shows whole minutes under an hour, floored', () => {
    expect(fmtElapsed(90_000)).toBe('1m'); // 1.5 min floors to 1
    expect(fmtElapsed(59 * 60_000)).toBe('59m');
  });

  it('never shows 0m for a task that just tipped into overdue', () => {
    expect(fmtElapsed(500)).toBe('1m');
  });

  it('shows whole hours once past 60 minutes, floored', () => {
    expect(fmtElapsed(60 * 60_000)).toBe('1h');
    expect(fmtElapsed(4 * 60 * 60_000 + 59 * 60_000)).toBe('4h');
  });

  it('shows whole days once past 24 hours, floored', () => {
    expect(fmtElapsed(24 * 60 * 60_000)).toBe('1d');
    expect(fmtElapsed(50 * 60 * 60_000)).toBe('2d');
  });
});
