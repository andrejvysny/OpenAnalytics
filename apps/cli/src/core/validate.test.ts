import { describe, expect, it } from 'bun:test';
import type { Session } from '@oa/schema';
import { sessionIssue } from './validate';

function makeSession(over: Partial<Session> = {}): Session {
  return {
    agent_kind: 'claude-code',
    session_id: '3f2a1c4e-8b7d-4f6a-9e1b-2c5d7a8f0b31',
    path_hash: 'a1b2c3d4e5f60718',
    started_at: '2026-05-24T00:00:00Z',
    ended_at: '2026-05-24T00:00:01Z',
    model: 'claude-opus-4-7',
    tokens: {
      input: 1,
      output: 2,
      cache_read: 0,
      cache_creation: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      reasoning: 0,
      extra_total: 0,
    },
    lines_added: 0,
    lines_removed: 0,
    lines_by_extension: {},
    tools: {},
    prompts: [],
    requests: [],
    subagents: {},
    ...over,
  };
}

describe('sessionIssue', () => {
  it('accepts a fully-formed session', () => {
    expect(sessionIssue(makeSession())).toBeNull();
  });

  it('reports a non-UUID session_id with a useful field and reason', () => {
    const issue = sessionIssue(makeSession({ session_id: 'agent-foo-1' }));
    expect(issue).toContain('session_id');
    expect(issue?.toLowerCase()).toContain('uuid');
  });

  it('reports a malformed path_hash', () => {
    const issue = sessionIssue(makeSession({ path_hash: 'h' }));
    expect(issue).toContain('path_hash');
  });

  it('reports nested issues with a dotted path', () => {
    const issue = sessionIssue(makeSession({ tokens: { ...makeSession().tokens, input: -1 } }));
    expect(issue).toContain('tokens.input');
  });

  it('handles non-object input without throwing', () => {
    expect(sessionIssue(null)).toBeString();
    expect(sessionIssue('nope')).toBeString();
  });
});
