export function currentPeriod(billingCycleDay: number): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const startMonth = d >= billingCycleDay ? m : m - 1;
  const from = new Date(Date.UTC(y, startMonth, billingCycleDay));
  const to = new Date(Date.UTC(y, startMonth + 1, billingCycleDay));
  return { from, to };
}

export function currentPeriodStartIso(billingCycleDay: number): string {
  return currentPeriod(billingCycleDay).from.toISOString().slice(0, 10);
}
