import { describe, expect, it } from 'vitest';
import { formatHourMinuteJst, formatMonthDayTimeJst } from '../../src/lib/date';

describe('formatMonthDayTimeJst', () => {
  it('formats the date and time in Japan time without the year', () => {
    expect(formatMonthDayTimeJst('2026-08-26T13:31:00.000Z')).toBe('8/26 22:31');
  });

  it('uses the Japan date around midnight', () => {
    expect(formatMonthDayTimeJst('2026-08-26T15:30:00.000Z')).toBe('8/27 00:30');
  });
});

describe('formatHourMinuteJst', () => {
  it('formats only the time in Japan time', () => {
    expect(formatHourMinuteJst('2026-09-05T03:34:00.000Z')).toBe('12:34');
  });
});
