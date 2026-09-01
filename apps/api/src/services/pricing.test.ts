import { describe, expect, test } from 'bun:test';
import { computeCost, normalizeModel } from './pricing';
import type { Db } from '../db';

describe('normalizeModel', () => {
  const cases: Array<[raw: string, exact: string, family: string | null]> = [
    // Tier-first (Claude 4.x+): date suffix, provider prefix and [1m] tier stripped.
    ['claude-opus-4-7-20251022', 'claude-opus-4-7', 'opus-4-7'],
    ['anthropic/claude-sonnet-4-6', 'claude-sonnet-4-6', 'sonnet-4-6'],
    ['claude-opus-4-7[1m]', 'claude-opus-4-7', 'opus-4-7'],
    ['claude-fable-5', 'claude-fable-5', 'fable-5'],
    ['claude-opus-5', 'claude-opus-5', 'opus-5'],
    // Version-first (Claude 3.x) canonicalizes to the tier-first price-table id.
    ['claude-3-5-haiku-20241022', 'claude-haiku-3-5', 'haiku-3-5'],
    ['claude-3-opus-20240229', 'claude-opus-3', 'opus-3'],
    ['claude-3-7-sonnet-20250219', 'claude-sonnet-3-7', 'sonnet-3-7'],
    // vibenalytics compaction placeholder — historically 4.7-era rows.
    ['<synthetic>', 'claude-opus-4-7', 'opus-4-7'],
    // Unknown ids pass through with no family fallback.
    ['gpt-9-turbo-ultra', 'gpt-9-turbo-ultra', null],
  ];

  for (const [raw, exact, family] of cases) {
    test(`${raw} -> ${exact}`, () => {
      expect(normalizeModel(raw)).toEqual({ exact, family });
    });
  }

  test('uppercase and surrounding whitespace are normalized away', () => {
    expect(normalizeModel('  ANTHROPIC/Claude-3-5-Haiku-20241022 ')).toEqual({
      exact: 'claude-haiku-3-5',
      family: 'haiku-3-5',
    });
  });

  test('empty input is passed through', () => {
    expect(normalizeModel('')).toEqual({ exact: '', family: null });
  });
});

describe('computeCost', () => {
  const priceRow = {
    inputPerMtok: '5',
    outputPerMtok: '25',
    cacheReadPerMtok: '0.5',
    cacheWrite5mPerMtok: '6.25',
    cacheWrite1hPerMtok: '10',
    model: 'claude-opus-5',
  };
  // Stub the single query computeCost issues via loadPrice.
  const stubDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [priceRow] }),
        }),
      }),
    }),
  } as unknown as Db;

  const base = {
    agentKind: 'claude-code',
    model: 'claude-opus-5',
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 0,
  };

  test('prices each token bucket at its per-Mtok rate', async () => {
    const cost = await computeCost(stubDb, {
      ...base,
      // Unique date so the module-level memo cannot leak between tests.
      startedAt: new Date('2026-08-02T00:00:00Z'),
      cacheCreation5mTokens: 1_000_000,
      cacheCreation1hTokens: 1_000_000,
    });
    expect(cost.input).toBe(5);
    expect(cost.output).toBe(25);
    expect(cost.cache_read).toBe(0.5);
    expect(cost.cache_creation_5m).toBe(6.25);
    expect(cost.cache_creation_1h).toBe(10);
    expect(cost.cache_creation).toBe(16.25);
    expect(cost.total).toBe(46.75);
    expect(cost.model_priced).toBe(true);
    expect(cost.model_resolved).toBe('claude-opus-5');
  });

  test('legacy cacheCreationTokens is billed as a 5m write', async () => {
    const cost = await computeCost(stubDb, {
      ...base,
      startedAt: new Date('2026-08-03T00:00:00Z'),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 2_000_000,
    });
    expect(cost.cache_creation_5m).toBe(12.5);
    expect(cost.cache_creation_1h).toBe(0);
    expect(cost.total).toBe(12.5);
  });
});
