#!/usr/bin/env bun
// Recompute cost_usd + cost_breakdown for existing sessions & requests using the
// current model_prices table. Idempotent. Run after seed-prices.ts changes.
//
// Usage:
//   bun apps/api/scripts/recompute-costs.ts                       # dry-run (default)
//   bun apps/api/scripts/recompute-costs.ts --apply               # write changes
//   bun apps/api/scripts/recompute-costs.ts --apply --since=2026-01-01
//   bun apps/api/scripts/recompute-costs.ts --apply --workspace=<uuid>

import { createDb, schema } from '@oa/db';
import { and, asc, eq, gte, gt, sql } from 'drizzle-orm';
import { computeCost } from '../src/services/pricing';

const URL = process.env.DATABASE_URL ?? 'postgres://oa:oa@localhost:5432/oa';
const db = createDb(URL);

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const [k, v = 'true'] = a.slice(2).split('=', 2);
  args.set(k!, v);
}
const apply = args.get('apply') === 'true';
const since = args.get('since') ? new Date(args.get('since')!) : null;
const workspaceId = args.get('workspace') ?? null;
const CHUNK = 500;

console.log(
  `[recompute] mode=${apply ? 'APPLY' : 'dry-run'} since=${since?.toISOString() ?? 'all'} workspace=${workspaceId ?? 'all'}`,
);

interface Totals {
  oldTotal: number;
  newTotal: number;
  changed: number;
  unpriced: number;
  scanned: number;
}

async function recomputeSessions(): Promise<Totals> {
  const t: Totals = { oldTotal: 0, newTotal: 0, changed: 0, unpriced: 0, scanned: 0 };
  let lastId: string | null = null;
  while (true) {
    const conds = [];
    if (since) conds.push(gte(schema.sessions.startedAt, since));
    if (workspaceId) conds.push(eq(schema.sessions.workspaceId, workspaceId));
    if (lastId) conds.push(gt(schema.sessions.id, lastId));
    const where = conds.length > 0 ? and(...conds) : undefined;

    const rows = await db
      .select({
        id: schema.sessions.id,
        agentKind: schema.sessions.agentKind,
        model: schema.sessions.model,
        startedAt: schema.sessions.startedAt,
        input: schema.sessions.inputTokens,
        output: schema.sessions.outputTokens,
        cacheRead: schema.sessions.cacheReadTokens,
        cacheCreation: schema.sessions.cacheCreationTokens,
        cacheCreation5m: schema.sessions.cacheCreation5mTokens,
        cacheCreation1h: schema.sessions.cacheCreation1hTokens,
        costUsd: schema.sessions.costUsd,
      })
      .from(schema.sessions)
      .where(where)
      .orderBy(asc(schema.sessions.id))
      .limit(CHUNK);
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1]!.id;

    for (const r of rows) {
      t.scanned++;
      const oldCost = Number(r.costUsd);
      t.oldTotal += oldCost;
      const cb = await computeCost(db, {
        agentKind: r.agentKind,
        model: r.model,
        startedAt: r.startedAt,
        inputTokens: r.input,
        outputTokens: r.output,
        cacheReadTokens: r.cacheRead,
        cacheCreationTokens: r.cacheCreation,
        cacheCreation5mTokens: r.cacheCreation5m,
        cacheCreation1hTokens: r.cacheCreation1h,
      });
      t.newTotal += cb.total;
      if (!cb.model_priced) t.unpriced++;
      if (Math.abs(cb.total - oldCost) > 1e-6) {
        t.changed++;
        if (apply) {
          await db
            .update(schema.sessions)
            .set({ costUsd: cb.total.toFixed(6), costBreakdown: cb })
            .where(eq(schema.sessions.id, r.id));
        }
      }
    }
    process.stdout.write(
      `\r[recompute] sessions scanned=${t.scanned} changed=${t.changed} unpriced=${t.unpriced}`,
    );
  }
  process.stdout.write('\n');
  return t;
}

async function recomputeRequests(): Promise<Totals> {
  const t: Totals = { oldTotal: 0, newTotal: 0, changed: 0, unpriced: 0, scanned: 0 };
  let lastId: string | null = null;
  while (true) {
    const conds = [];
    // Filter on the indexed ts_bucket rather than the unindexed ts.
    if (since) conds.push(gte(schema.requests.tsBucket, since));
    if (lastId) conds.push(gt(schema.requests.id, lastId));
    // Always join sessions so we can price each request with its own agent_kind.
    let q = db
      .select({
        id: schema.requests.id,
        sessionId: schema.requests.sessionId,
        agentKind: schema.sessions.agentKind,
        model: schema.requests.model,
        ts: schema.requests.ts,
        input: schema.requests.inputTokens,
        output: schema.requests.outputTokens,
        cacheRead: schema.requests.cacheReadTokens,
        cacheCreation: schema.requests.cacheCreationTokens,
        cacheCreation5m: schema.requests.cacheCreation5mTokens,
        cacheCreation1h: schema.requests.cacheCreation1hTokens,
        costUsd: schema.requests.costUsd,
      })
      .from(schema.requests)
      .innerJoin(schema.sessions, eq(schema.sessions.id, schema.requests.sessionId))
      .$dynamic();
    if (workspaceId) {
      q = q.where(and(eq(schema.sessions.workspaceId, workspaceId), ...conds));
    } else if (conds.length > 0) {
      q = q.where(and(...conds));
    }
    const rows = await q.orderBy(asc(schema.requests.id)).limit(CHUNK);
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1]!.id;

    for (const r of rows) {
      t.scanned++;
      const oldCost = Number(r.costUsd);
      t.oldTotal += oldCost;
      const cb = await computeCost(db, {
        agentKind: r.agentKind,
        model: r.model,
        startedAt: r.ts,
        inputTokens: r.input,
        outputTokens: r.output,
        cacheReadTokens: r.cacheRead,
        cacheCreationTokens: r.cacheCreation,
        cacheCreation5mTokens: r.cacheCreation5m,
        cacheCreation1hTokens: r.cacheCreation1h,
      });
      t.newTotal += cb.total;
      if (!cb.model_priced) t.unpriced++;
      if (Math.abs(cb.total - oldCost) > 1e-6) {
        t.changed++;
        if (apply) {
          await db
            .update(schema.requests)
            .set({ costUsd: cb.total.toFixed(6) })
            .where(eq(schema.requests.id, r.id));
        }
      }
    }
    process.stdout.write(
      `\r[recompute] requests scanned=${t.scanned} changed=${t.changed} unpriced=${t.unpriced}`,
    );
  }
  process.stdout.write('\n');
  return t;
}

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

const sTotals = await recomputeSessions();
const rTotals = await recomputeRequests();

console.log('\n[recompute] summary');
console.log(
  `  sessions: ${sTotals.scanned} scanned, ${sTotals.changed} changed, ${sTotals.unpriced} unpriced`,
);
console.log(
  `            old=${fmt(sTotals.oldTotal)}  new=${fmt(sTotals.newTotal)}  delta=${fmt(sTotals.newTotal - sTotals.oldTotal)}`,
);
console.log(
  `  requests: ${rTotals.scanned} scanned, ${rTotals.changed} changed, ${rTotals.unpriced} unpriced`,
);
console.log(
  `            old=${fmt(rTotals.oldTotal)}  new=${fmt(rTotals.newTotal)}  delta=${fmt(rTotals.newTotal - rTotals.oldTotal)}`,
);
if (!apply) {
  console.log('\n[recompute] dry-run — pass --apply to write changes');
}

// Silence unused import warning when neither --since nor --workspace is used.
void sql;
process.exit(0);
