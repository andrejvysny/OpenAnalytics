import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from 'hono/bun';
import { env } from '../env';

// Resolve the client IP. X-Forwarded-For is attacker-controllable, so we only
// trust it when TRUST_PROXY is set (i.e. we sit behind a known proxy like Caddy);
// otherwise we use the real socket address.
export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const xff = c.req.header('x-forwarded-for');
    const first = xff?.split(',')[0]?.trim();
    if (first) return first;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory fixed-window rate limiter. Sufficient for the single-instance
// self-hosted deployment; swap for a shared store (Redis) if scaled horizontally.
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (c: Context) => string;
}): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;
  const keyOf = opts.key ?? clientIp;

  return async (c, next) => {
    const now = Date.now();
    if (now - lastSweep > opts.windowMs) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }

    const key = keyOf(c);
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    b.count += 1;
    if (b.count > opts.max) {
      c.header('retry-after', String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))));
      return c.json({ ok: false, error: 'too many requests, slow down' }, 429);
    }
    return next();
  };
}
