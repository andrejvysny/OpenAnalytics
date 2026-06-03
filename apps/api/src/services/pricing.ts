import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { schema } from '@oa/db';
import type { Db } from '../db';

export interface PriceInputs {
  agentKind: string;
  model: string;
  startedAt: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  // Legacy total — used as 5m when 5m/1h split is not provided.
  cacheCreationTokens: number;
  cacheCreation5mTokens?: number;
  cacheCreation1hTokens?: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  cache_creation_5m: number;
  cache_creation_1h: number;
  total: number;
  model_priced: boolean;
  model_resolved?: string | null;
}

type PriceRow = typeof schema.modelPrices.$inferSelect | null;
const MEMO = new Map<string, { fetchedAt: number; row: PriceRow }>();
const INFLIGHT = new Map<string, Promise<PriceRow>>();
const TTL_MS = 60_000;
const MAX_MEMO = 2000; // bound module-global caches on a long-lived server
const UNPRICED_WARNED = new Set<string>();

// Normalize raw model identifiers from JSONL into canonical price-table ids.
// Examples:
//   "claude-opus-4-7-20251022" -> { exact: "claude-opus-4-7", family: "opus-4-7" }
//   "claude-opus-4-7[1m]"      -> { exact: "claude-opus-4-7", family: "opus-4-7" }
//   "anthropic/claude-sonnet-4-6" -> { exact: "claude-sonnet-4-6", family: "sonnet-4-6" }
export function normalizeModel(raw: string): { exact: string; family: string | null } {
  if (!raw) return { exact: raw, family: null };
  const lowered = raw.toLowerCase().trim();
  // Compaction-summary sessions from the Rust `vibenalytics` CLI carry the
  // synthetic placeholder model. They DO contain real usage tokens and
  // therefore real cost — price them at the user's primary model (Opus 4.7).
  if (lowered === '<synthetic>') return { exact: 'claude-opus-4-7', family: 'opus-4-7' };
  const noProvider = lowered.replace(/^anthropic\//, '');
  const noTier = noProvider.replace(/\[[^\]]*\]/g, '');
  const noDate = noTier.replace(/-\d{8}$/, '');
  let family: string | null = null;
  const m = noDate.match(/^claude-(opus|sonnet|haiku)-(\d+(?:-\d+)?)/);
  if (m) family = `${m[1]}-${m[2]}`;
  return { exact: noDate, family };
}

async function loadPrice(db: Db, agentKind: string, model: string, at: Date) {
  const key = `${agentKind}::${model}::${at.toISOString().slice(0, 10)}`;
  const cached = MEMO.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.row;

  // Collapse concurrent misses for the same key into one query — avoids a
  // thundering herd of identical SELECTs when a request batch first sees a model.
  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;
  const promise = fetchPrice(db, agentKind, model, at, key).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, promise);
  return promise;
}

async function fetchPrice(
  db: Db,
  agentKind: string,
  model: string,
  at: Date,
  key: string,
): Promise<PriceRow> {
  const { exact, family } = normalizeModel(model);

  const baseConds = (modelEqExpr: ReturnType<typeof eq>) =>
    and(
      eq(schema.modelPrices.agentKind, agentKind),
      modelEqExpr,
      lte(schema.modelPrices.effectiveFrom, at),
      or(isNull(schema.modelPrices.effectiveTo), gt(schema.modelPrices.effectiveTo, at)),
    );

  // 1) Try exact (normalized) match.
  let rows = await db
    .select()
    .from(schema.modelPrices)
    .where(baseConds(eq(schema.modelPrices.model, exact)))
    .orderBy(desc(schema.modelPrices.effectiveFrom))
    .limit(1);

  // 2) Try raw match (in case caller already passed an exact seeded id).
  if (rows.length === 0 && exact !== model.toLowerCase().trim()) {
    rows = await db
      .select()
      .from(schema.modelPrices)
      .where(baseConds(eq(schema.modelPrices.model, model.toLowerCase().trim())))
      .orderBy(desc(schema.modelPrices.effectiveFrom))
      .limit(1);
  }

  // 3) Family fallback.
  if (rows.length === 0 && family) {
    rows = await db
      .select()
      .from(schema.modelPrices)
      .where(baseConds(eq(schema.modelPrices.modelFamily, family)))
      .orderBy(desc(schema.modelPrices.effectiveFrom))
      .limit(1);
  }

  const row = rows[0] ?? null;
  if (!row && !UNPRICED_WARNED.has(model)) {
    if (UNPRICED_WARNED.size > MAX_MEMO) UNPRICED_WARNED.clear();
    UNPRICED_WARNED.add(model);
    console.warn(
      `[pricing] no price row for agentKind=${agentKind} model="${model}" (normalized=${exact}, family=${family}) at ${at.toISOString()} — cost will be 0`,
    );
  }
  MEMO.set(key, { fetchedAt: Date.now(), row });
  // Evict oldest entry when the cache grows past its cap (Map preserves insertion order).
  if (MEMO.size > MAX_MEMO) {
    const oldest = MEMO.keys().next().value;
    if (oldest !== undefined) MEMO.delete(oldest);
  }
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
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      total: 0,
      model_priced: false,
      model_resolved: null,
    };
  }
  const inputPerMtok = Number(row.inputPerMtok);
  const outputPerMtok = Number(row.outputPerMtok);
  const cacheReadPerMtok = Number(row.cacheReadPerMtok);
  const cacheWrite5mPerMtok = Number(row.cacheWrite5mPerMtok);
  const cacheWrite1hPerMtok = Number(row.cacheWrite1hPerMtok ?? cacheWrite5mPerMtok);

  // Resolve 5m / 1h cache tokens with legacy fallback.
  const has5m = typeof p.cacheCreation5mTokens === 'number';
  const has1h = typeof p.cacheCreation1hTokens === 'number';
  let tokens5m = has5m ? (p.cacheCreation5mTokens as number) : 0;
  const tokens1h = has1h ? (p.cacheCreation1hTokens as number) : 0;
  if (!has5m && !has1h) tokens5m = p.cacheCreationTokens;

  const input = (p.inputTokens / 1_000_000) * inputPerMtok;
  const output = (p.outputTokens / 1_000_000) * outputPerMtok;
  const cache_read = (p.cacheReadTokens / 1_000_000) * cacheReadPerMtok;
  const cache_creation_5m = (tokens5m / 1_000_000) * cacheWrite5mPerMtok;
  const cache_creation_1h = (tokens1h / 1_000_000) * cacheWrite1hPerMtok;
  const cache_creation = cache_creation_5m + cache_creation_1h;
  const total = input + output + cache_read + cache_creation;
  return {
    input,
    output,
    cache_read,
    cache_creation,
    cache_creation_5m,
    cache_creation_1h,
    total,
    model_priced: true,
    model_resolved: row.model,
  };
}
