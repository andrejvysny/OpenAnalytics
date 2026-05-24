import { and, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { schema } from '@oa/db';
import type { Db } from '../db';

export interface PriceInputs {
  agentKind: string;
  model: string;
  startedAt: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  total: number;
  model_priced: boolean;
}

const MEMO = new Map<
  string,
  { fetchedAt: number; row: typeof schema.modelPrices.$inferSelect | null }
>();
const TTL_MS = 60_000;

async function loadPrice(db: Db, agentKind: string, model: string, at: Date) {
  const key = `${agentKind}::${model}::${at.toISOString().slice(0, 10)}`;
  const cached = MEMO.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.row;

  const rows = await db
    .select()
    .from(schema.modelPrices)
    .where(
      and(
        eq(schema.modelPrices.agentKind, agentKind),
        eq(schema.modelPrices.model, model),
        lte(schema.modelPrices.effectiveFrom, at),
        or(isNull(schema.modelPrices.effectiveTo), lte(schema.modelPrices.effectiveTo, at)),
      ),
    )
    .orderBy(desc(schema.modelPrices.effectiveFrom))
    .limit(1);

  const row = rows[0] ?? null;
  MEMO.set(key, { fetchedAt: now, row });
  return row;
}

export async function computeCost(db: Db, p: PriceInputs): Promise<CostBreakdown> {
  const row = await loadPrice(db, p.agentKind, p.model, p.startedAt);
  if (!row) {
    return {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
      total: 0,
      model_priced: false,
    };
  }
  const inputPerMtok = Number(row.inputPerMtok);
  const outputPerMtok = Number(row.outputPerMtok);
  const cacheReadPerMtok = Number(row.cacheReadPerMtok);
  const cacheWritePerMtok = Number(row.cacheWritePerMtok);

  const input = (p.inputTokens / 1_000_000) * inputPerMtok;
  const output = (p.outputTokens / 1_000_000) * outputPerMtok;
  const cache_read = (p.cacheReadTokens / 1_000_000) * cacheReadPerMtok;
  const cache_creation = (p.cacheCreationTokens / 1_000_000) * cacheWritePerMtok;
  const total = input + output + cache_read + cache_creation;
  return { input, output, cache_read, cache_creation, total, model_priced: true };
}
