// Canonical Claude.ai plan presets. Numbers from https://claude.com/pricing (May 2026).
// `priceUsd: null` means "pay-as-you-go API" or "user-defined custom" — no allowance.

export type PlanKind = 'api' | 'pro' | 'max_5x' | 'max_20x' | 'custom';

export const PLAN_KINDS: PlanKind[] = ['api', 'pro', 'max_5x', 'max_20x', 'custom'];

export const PLAN_PRESETS: Record<PlanKind, { name: string; priceUsd: number | null }> = {
  api: { name: 'API (pay-as-you-go)', priceUsd: null },
  pro: { name: 'Claude Pro', priceUsd: 20 },
  max_5x: { name: 'Claude Max 5x', priceUsd: 100 },
  max_20x: { name: 'Claude Max 20x', priceUsd: 200 },
  custom: { name: 'Custom', priceUsd: null },
};

export function planNameFor(kind: PlanKind): string {
  return PLAN_PRESETS[kind]?.name ?? 'Custom';
}

export function defaultPriceFor(kind: PlanKind): number | null {
  return PLAN_PRESETS[kind]?.priceUsd ?? null;
}
