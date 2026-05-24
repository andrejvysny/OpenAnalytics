import { describe, expect, it } from 'bun:test';
import type { Session } from '@oa/schema';
import { mergeSubagent } from './scan';

function makeSession(over: Partial<Session['tokens']> = {}): Session {
  return {
    agent_kind: 'claude-code',
    session_id: 'sess',
    path_hash: 'h',
    started_at: '2026-05-24T00:00:00Z',
    ended_at: '2026-05-24T00:00:01Z',
    model: 'claude-opus-4-7',
    tokens: {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      reasoning: 0,
      ...over,
    },
    lines_added: 0,
    lines_removed: 0,
    lines_by_extension: {},
    tools: {},
    prompts: [],
    requests: [],
    subagents: {},
  };
}

describe('mergeSubagent', () => {
  it('sums the 5m and 1h cache split, not just the legacy total', () => {
    const parent = makeSession({
      cache_creation: 100,
      cache_creation_5m: 100,
      cache_creation_1h: 0,
    });
    const child = makeSession({
      cache_creation: 500,
      cache_creation_5m: 200,
      cache_creation_1h: 300,
    });
    mergeSubagent(parent, child, '/x/subagents/agent-foo.jsonl');
    expect(parent.tokens.cache_creation).toBe(600);
    expect(parent.tokens.cache_creation_5m).toBe(300);
    expect(parent.tokens.cache_creation_1h).toBe(300);
    // Without the fix, 5m and 1h stayed at parent-only values (100/0) and the
    // subagent's 500 cache-write tokens were silently zero-priced downstream.
  });

  it('still merges basic token totals', () => {
    const parent = makeSession({ input: 10, output: 20, cache_read: 30, reasoning: 0 });
    const child = makeSession({ input: 1, output: 2, cache_read: 3, reasoning: 4 });
    mergeSubagent(parent, child, '/x/subagents/agent-bar.jsonl');
    expect(parent.tokens.input).toBe(11);
    expect(parent.tokens.output).toBe(22);
    expect(parent.tokens.cache_read).toBe(33);
    expect(parent.tokens.reasoning).toBe(4);
    expect(parent.subagents['claude-code-subagent']).toBe(1);
  });
});
