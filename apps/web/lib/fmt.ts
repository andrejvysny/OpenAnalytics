type Numeric = string | number | null | undefined;

export function money(v: Numeric): string {
  const n = v == null ? 0 : typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '$0';
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function num(v: Numeric): string {
  const n = v == null ? 0 : typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

export function tokens(v: Numeric): string {
  const n = v == null ? 0 : Number(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function pct(p: number): string {
  return `${p.toFixed(1)}%`;
}
