import { afterAll, describe, expect, test } from 'bun:test';
import { setSystemTime } from 'bun:test';
import { currentPeriod, currentPeriodStartIso } from './billing';

// Pure date maths, but it reads `new Date()` — pin the clock so the assertions are
// not calendar-dependent. Everything is UTC by contract.
function at(iso: string): void {
  setSystemTime(new Date(iso));
}

function period(iso: string, cycleDay: number): [string, string] {
  at(iso);
  const { from, to } = currentPeriod(cycleDay);
  return [from.toISOString(), to.toISOString()];
}

afterAll(() => setSystemTime());

describe('currentPeriod', () => {
  test('cycle day 1 spans calendar months', () => {
    expect(period('2026-03-15T12:00:00Z', 1)).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ]);
  });

  test('the cycle day itself starts the new period, the day before does not', () => {
    expect(period('2026-03-15T00:00:00Z', 15)).toEqual([
      '2026-03-15T00:00:00.000Z',
      '2026-04-15T00:00:00.000Z',
    ]);
    expect(period('2026-03-14T23:59:59Z', 15)).toEqual([
      '2026-02-15T00:00:00.000Z',
      '2026-03-15T00:00:00.000Z',
    ]);
  });

  test('the first of the month with cycle day 1 is already inside the new period', () => {
    expect(period('2026-01-01T00:00:00Z', 1)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    ]);
  });

  test('cycle day 31 clamps into February (non-leap year)', () => {
    expect(period('2026-02-15T12:00:00Z', 31)).toEqual([
      '2026-01-31T00:00:00.000Z',
      '2026-02-28T00:00:00.000Z',
    ]);
  });

  test('cycle day 31 clamps into February (leap year)', () => {
    expect(period('2028-02-15T12:00:00Z', 31)).toEqual([
      '2028-01-31T00:00:00.000Z',
      '2028-02-29T00:00:00.000Z',
    ]);
  });

  test('a clamped February end rolls straight into March', () => {
    expect(period('2026-03-01T00:00:00Z', 31)).toEqual([
      '2026-02-28T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
    ]);
  });

  test('cycle day 31 clamps to the 30th in a 30-day month', () => {
    // April has 30 days, so the 30th is "the cycle day" and starts the new period.
    expect(period('2026-04-30T09:00:00Z', 31)).toEqual([
      '2026-04-30T00:00:00.000Z',
      '2026-05-31T00:00:00.000Z',
    ]);
    expect(period('2026-04-29T23:00:00Z', 31)).toEqual([
      '2026-03-31T00:00:00.000Z',
      '2026-04-30T00:00:00.000Z',
    ]);
  });

  test('crosses the year boundary backwards', () => {
    expect(period('2026-01-10T00:00:00Z', 15)).toEqual([
      '2025-12-15T00:00:00.000Z',
      '2026-01-15T00:00:00.000Z',
    ]);
  });

  test('crosses the year boundary forwards', () => {
    expect(period('2026-12-20T00:00:00Z', 15)).toEqual([
      '2026-12-15T00:00:00.000Z',
      '2027-01-15T00:00:00.000Z',
    ]);
  });

  test('the period is always half-open: to == the next period from', () => {
    at('2026-02-15T12:00:00Z');
    const first = currentPeriod(31);
    at(first.to.toISOString());
    expect(currentPeriod(31).from.toISOString()).toBe(first.to.toISOString());
  });
});

describe('currentPeriodStartIso', () => {
  test('returns the period start as a bare date', () => {
    at('2026-02-15T12:00:00Z');
    expect(currentPeriodStartIso(31)).toBe('2026-01-31');
    at('2026-03-15T12:00:00Z');
    expect(currentPeriodStartIso(1)).toBe('2026-03-01');
  });
});
