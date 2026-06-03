import { describe, expect, it } from 'vitest';
import {
  parseClaudeUsageEvent,
  parseCodexUsageEvent,
  parseGeminiUsageEvent,
  parseOpenCodeUsageEvent,
} from '../src/usage-events.js';

describe('local usage events', () => {
  it('parses Claude/Anthropic cache split', () => {
    const event = parseClaudeUsageEvent({
      type: 'assistant',
      sessionId: 's1',
      timestamp: '2026-05-26T00:00:00.000Z',
      message: {
        model: 'claude-opus-4-7',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation: {
            ephemeral_5m_input_tokens: 40,
            ephemeral_1h_input_tokens: 50,
          },
        },
      },
    });
    expect(event?.tokens).toMatchObject({
      input: 10,
      output: 20,
      cache_read: 30,
      cache_creation: 90,
      cache_creation_5m: 40,
      cache_creation_1h: 50,
    });
  });

  it('parses Codex/OpenAI response usage', () => {
    const event = parseCodexUsageEvent({
      session_id: 's2',
      ts: '2026-05-26T00:00:00.000Z',
      response: {
        model: 'gpt-5.1-codex',
        usage: {
          input_tokens: 11,
          output_tokens: 22,
          input_tokens_details: { cached_tokens: 3 },
          output_tokens_details: { reasoning_tokens: 4 },
        },
      },
    });
    expect(event?.tokens).toMatchObject({ input: 11, output: 22, cache_read: 3, reasoning: 4 });
  });

  it('parses OpenCode camel-case tokens', () => {
    const event = parseOpenCodeUsageEvent({
      sessionId: 's3',
      timestamp: '2026-05-26T00:00:00.000Z',
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheWriteInputTokens: 4,
      },
    });
    expect(event?.tokens).toMatchObject({
      input: 1,
      output: 2,
      cache_read: 3,
      cache_creation: 4,
      cache_creation_5m: 4,
    });
  });

  it('parses Gemini usageMetadata', () => {
    const event = parseGeminiUsageEvent({
      session_id: 's4',
      timestamp: '2026-05-26T00:00:00.000Z',
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 6,
        cachedContentTokenCount: 7,
        thoughtsTokenCount: 8,
      },
    });
    expect(event?.tokens).toMatchObject({ input: 5, output: 6, cache_read: 7, reasoning: 8 });
  });

  it('stores extra_total as the residual of the grand total, never the raw total', () => {
    const event = parseCodexUsageEvent({
      session_id: 's5',
      ts: '2026-05-26T00:00:00.000Z',
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 4 },
        total_tokens: 45, // known buckets = 11+22+3+4 = 40 → residual must be 5
      },
    });
    // Must be the residual (5), NOT the raw grand total (45) — otherwise additive
    // sums downstream (plan split, oa usage totals) would ~double-count.
    expect(event?.tokens.extra_total).toBe(5);
  });

  it('clamps extra_total to 0 when the grand total is missing or already covered', () => {
    const event = parseCodexUsageEvent({
      session_id: 's6',
      ts: '2026-05-26T00:00:00.000Z',
      usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 },
    });
    expect(event?.tokens.extra_total).toBe(0);
  });
});
