import { describe, expect, it } from 'vitest';
import { fmtHours } from './format';

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
