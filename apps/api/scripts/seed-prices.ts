#!/usr/bin/env bun
// Seed canonical Anthropic model_prices effective 2026-01-01. Idempotent.

import { createDb, schema } from '@oa/db';
import { and, eq } from 'drizzle-orm';

const URL = process.env.DATABASE_URL ?? 'postgres://oa:oa@localhost:5432/oa';
const db = createDb(URL);

const FROM = new Date('2026-01-01T00:00:00Z');

// Anthropic pricing as of January 2026 (USD per million tokens).
// Cache write = "cache_creation". Cache read is the discounted rate.
const PRICES: Array<{
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}> = [
  // Opus 4.x family
  { model: 'claude-opus-4-7', input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
  { model: 'claude-opus-4-6', input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
  { model: 'claude-opus-4-5', input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
  // Sonnet 4.x family
  { model: 'claude-sonnet-4-6', input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  { model: 'claude-sonnet-4-5', input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  // Haiku 4.x family
  { model: 'claude-haiku-4-5-20251001', input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  { model: 'claude-haiku-4-5', input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
];

for (const p of PRICES) {
  const existing = await db
    .select({ id: schema.modelPrices.id })
    .from(schema.modelPrices)
    .where(
      and(
        eq(schema.modelPrices.agentKind, 'claude-code'),
        eq(schema.modelPrices.model, p.model),
        eq(schema.modelPrices.effectiveFrom, FROM),
      ),
    );
  if (existing.length > 0) {
    console.log('skip', p.model);
    continue;
  }
  await db.insert(schema.modelPrices).values({
    agentKind: 'claude-code',
    model: p.model,
    effectiveFrom: FROM,
    effectiveTo: null,
    inputPerMtok: p.input.toString(),
    outputPerMtok: p.output.toString(),
    cacheReadPerMtok: p.cache_read.toString(),
    cacheWritePerMtok: p.cache_write.toString(),
    currency: 'USD',
  });
  console.log('seed', p.model);
}
process.exit(0);
