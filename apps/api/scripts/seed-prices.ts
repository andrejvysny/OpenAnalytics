#!/usr/bin/env bun
// Seed canonical Anthropic model_prices. Idempotent (upserts per agent/model/effective_from).
// Source: https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-08-02).
//
// To refresh: re-read the pricing page (or the `claude-api` skill's model table),
// update/append rows below, re-run this script, then run
// `apps/api/scripts/recompute-costs.ts` to backfill sessions already ingested at
// the old rates. Adding a model here is NOT retroactive on its own.

import { createDb, schema } from '@oa/db';
import { and, eq } from 'drizzle-orm';

const URL = process.env.DATABASE_URL ?? 'postgres://oa:oa@localhost:5432/oa';
const db = createDb(URL);

// Open-ended floor so historically backfilled sessions (`oa import`) are priced
// rather than silently costing $0. These are the latest known rates applied across
// all history; add dated rows if you need period-accurate historical pricing.
const FROM = new Date('2020-01-01T00:00:00Z');

// All rates are USD per million tokens.
// Multipliers off base input: 5m = 1.25x, 1h = 2x, cache_read = 0.1x, output = 5x (4.x models).
// `effective_from` defaults to FROM. Rows with a later date win for sessions on or
// after it — fetchPrice picks the newest effective_from <= the session start.
const PRICES: Array<{
  model: string;
  family: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  effective_from?: Date;
}> = [
  // Fable 5 — highest tier, above Opus.
  {
    model: 'claude-fable-5',
    family: 'fable-5',
    input: 10,
    output: 50,
    cache_read: 1,
    cache_write_5m: 12.5,
    cache_write_1h: 20,
  },
  // Opus 5 / 4.8 — current Opus pricing, same as 4.7.
  {
    model: 'claude-opus-5',
    family: 'opus-5',
    input: 5,
    output: 25,
    cache_read: 0.5,
    cache_write_5m: 6.25,
    cache_write_1h: 10,
  },
  {
    model: 'claude-opus-4-8',
    family: 'opus-4-8',
    input: 5,
    output: 25,
    cache_read: 0.5,
    cache_write_5m: 6.25,
    cache_write_1h: 10,
  },
  // Opus 4.5+ (current Opus pricing — Anthropic cut these to 1/3 of legacy)
  {
    model: 'claude-opus-4-7',
    family: 'opus-4-7',
    input: 5,
    output: 25,
    cache_read: 0.5,
    cache_write_5m: 6.25,
    cache_write_1h: 10,
  },
  {
    model: 'claude-opus-4-6',
    family: 'opus-4-6',
    input: 5,
    output: 25,
    cache_read: 0.5,
    cache_write_5m: 6.25,
    cache_write_1h: 10,
  },
  {
    model: 'claude-opus-4-5',
    family: 'opus-4-5',
    input: 5,
    output: 25,
    cache_read: 0.5,
    cache_write_5m: 6.25,
    cache_write_1h: 10,
  },
  // Opus 4.1 / Opus 4 — legacy pricing retained per docs.
  {
    model: 'claude-opus-4-1',
    family: 'opus-4-1',
    input: 15,
    output: 75,
    cache_read: 1.5,
    cache_write_5m: 18.75,
    cache_write_1h: 30,
  },
  {
    model: 'claude-opus-4',
    family: 'opus-4',
    input: 15,
    output: 75,
    cache_read: 1.5,
    cache_write_5m: 18.75,
    cache_write_1h: 30,
  },
  // Sonnet 5 — introductory rate through 2026-08-31, then regular from 2026-09-01.
  // The intro row keeps the open-ended floor; the dated row shadows it afterwards.
  {
    model: 'claude-sonnet-5',
    family: 'sonnet-5',
    input: 2,
    output: 10,
    cache_read: 0.2,
    cache_write_5m: 2.5,
    cache_write_1h: 4,
  },
  {
    model: 'claude-sonnet-5',
    family: 'sonnet-5',
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
    effective_from: new Date('2026-09-01T00:00:00Z'),
  },
  // Sonnet 4.x
  {
    model: 'claude-sonnet-4-6',
    family: 'sonnet-4-6',
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
  },
  {
    model: 'claude-sonnet-4-5',
    family: 'sonnet-4-5',
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
  },
  {
    model: 'claude-sonnet-4',
    family: 'sonnet-4',
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
  },
  // Haiku
  {
    model: 'claude-haiku-4-5',
    family: 'haiku-4-5',
    input: 1,
    output: 5,
    cache_read: 0.1,
    cache_write_5m: 1.25,
    cache_write_1h: 2,
  },
  {
    model: 'claude-haiku-4-5-20251001',
    family: 'haiku-4-5',
    input: 1,
    output: 5,
    cache_read: 0.1,
    cache_write_5m: 1.25,
    cache_write_1h: 2,
  },
  {
    model: 'claude-haiku-3-5',
    family: 'haiku-3-5',
    input: 0.8,
    output: 4,
    cache_read: 0.08,
    cache_write_5m: 1,
    cache_write_1h: 1.6,
  },
  // Claude 3.x — retired models, kept so historical `oa import` sessions price.
  // Canonicalized tier-first by normalizeModel (`claude-3-7-sonnet-…` -> `claude-sonnet-3-7`).
  {
    model: 'claude-sonnet-3-7',
    family: 'sonnet-3-7',
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
  },
  {
    model: 'claude-sonnet-3-5',
    family: 'sonnet-3-5',
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
  },
  {
    model: 'claude-opus-3',
    family: 'opus-3',
    input: 15,
    output: 75,
    cache_read: 1.5,
    cache_write_5m: 18.75,
    cache_write_1h: 30,
  },
  {
    model: 'claude-haiku-3',
    family: 'haiku-3',
    input: 0.25,
    output: 1.25,
    cache_read: 0.025,
    cache_write_5m: 0.3125,
    cache_write_1h: 0.5,
  },
];

for (const p of PRICES) {
  const from = p.effective_from ?? FROM;
  const existing = await db
    .select({ id: schema.modelPrices.id })
    .from(schema.modelPrices)
    .where(
      and(
        eq(schema.modelPrices.agentKind, 'claude-code'),
        eq(schema.modelPrices.model, p.model),
        eq(schema.modelPrices.effectiveFrom, from),
      ),
    );
  const values = {
    agentKind: 'claude-code',
    model: p.model,
    modelFamily: p.family,
    effectiveFrom: from,
    effectiveTo: null,
    inputPerMtok: p.input.toString(),
    outputPerMtok: p.output.toString(),
    cacheReadPerMtok: p.cache_read.toString(),
    cacheWrite5mPerMtok: p.cache_write_5m.toString(),
    cacheWrite1hPerMtok: p.cache_write_1h.toString(),
    currency: 'USD',
  };
  if (existing.length > 0) {
    await db
      .update(schema.modelPrices)
      .set({
        modelFamily: values.modelFamily,
        inputPerMtok: values.inputPerMtok,
        outputPerMtok: values.outputPerMtok,
        cacheReadPerMtok: values.cacheReadPerMtok,
        cacheWrite5mPerMtok: values.cacheWrite5mPerMtok,
        cacheWrite1hPerMtok: values.cacheWrite1hPerMtok,
      })
      .where(eq(schema.modelPrices.id, existing[0]!.id));
    console.log('update', p.model, from.toISOString().slice(0, 10));
    continue;
  }
  await db.insert(schema.modelPrices).values(values);
  console.log('seed', p.model, from.toISOString().slice(0, 10));
}
process.exit(0);
