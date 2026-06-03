// Construct a UTC midnight date for (year, monthIndex, day), clamping `day` to the
// target month's length so cycle days 29-31 don't overflow into the next month
// (e.g. day 31 in February resolves to Feb 28/29). monthIndex may be out of range;
// JS normalizes it (and the year) first.
function clampedUtcDay(year: number, monthIndex: number, day: number): Date {
  const base = new Date(Date.UTC(year, monthIndex, 1));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, daysInMonth)));
}

export function currentPeriod(billingCycleDay: number): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const daysInThisMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const startMonth = d >= Math.min(billingCycleDay, daysInThisMonth) ? m : m - 1;
  const from = clampedUtcDay(y, startMonth, billingCycleDay);
  const to = clampedUtcDay(y, startMonth + 1, billingCycleDay);
  return { from, to };
}

export function currentPeriodStartIso(billingCycleDay: number): string {
  return currentPeriod(billingCycleDay).from.toISOString().slice(0, 10);
}
