type Numeric = string | number | null | undefined;

// Full dollars under $10K (preserves accuracy on small balances), K above, M above 1M.
export function money(v: Numeric): string {
  const n = v == null ? 0 : typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

// Exact value, for tooltips and detail views.
export function moneyExact(v: Numeric): string {
  const n = v == null ? 0 : typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function num(v: Numeric): string {
  const n = v == null ? 0 : typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

export function tokens(v: Numeric): string {
  const n = v == null ? 0 : Number(v);
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function pct(p: number): string {
  return `${p.toFixed(1)}%`;
}
