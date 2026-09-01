import { describe, expect, it } from 'vitest';
import { Session } from '@oa/schema';
import {
  AggregatorIncompleteError,
  applyLine,
  finalize,
  newState,
} from '../src/adapters/claude-code/index.js';
import { parseTranscript } from '../src/adapters/claude-code/parse.js';

const SID = '00000000-0000-0000-0000-0000000000aa';

function line(ev: Record<string, unknown>): string {
  return JSON.stringify(ev);
}

function userLine(over: Record<string, unknown> = {}): string {
  return line({
    type: 'user',
    sessionId: SID,
    promptId: 'p1',
    timestamp: '2026-05-24T11:00:00.000Z',
    cwd: '/tmp/proj',
    message: { role: 'user', content: 'hello' },
    ...over,
  });
}

function assistantLine(over: Record<string, unknown> = {}): string {
  return line({
    type: 'assistant',
    sessionId: SID,
    timestamp: '2026-05-24T11:00:01.000Z',
    cwd: '/tmp/proj',
    version: '1.0.0',
    message: {
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
    ...over,
  });
}

function transcript(lines: string[]): string {
  return lines.join('\n');
}

// A transcript is an append-only log that can be read mid-write, so truncated and
// otherwise malformed lines are normal. Each one must cost at most its own line.
describe('aggregator resilience to malformed lines', () => {
  it('skips an assistant event with no message object and keeps the session', () => {
    const s = parseTranscript(
      SID,
      transcript([
        userLine(),
        line({ type: 'assistant', sessionId: SID, timestamp: '2026-05-24T11:00:02.000Z' }),
        assistantLine(),
      ]),
    );
    expect(() => Session.parse(s)).not.toThrow();
    expect(s.requests).toHaveLength(1); // only the well-formed assistant produced one
    expect(s.tokens.input).toBe(10);
    expect(s.tokens.output).toBe(20);
    // The broken line still advanced the session's end timestamp.
    expect(s.ended_at).toBe('2026-05-24T11:00:02.000Z');
  });

  it('skips an assistant event whose message is null or a primitive', () => {
    for (const message of [null, false, 'oops', 42]) {
      const s = parseTranscript(
        SID,
        transcript([userLine(), assistantLine({ message }), assistantLine()]),
      );
      expect(s.requests).toHaveLength(1);
      expect(s.tokens.input).toBe(10);
    }
  });

  it('an array message passes the object guard but contributes nothing billable', () => {
    // `typeof [] === 'object'`, so this shape reaches the usage/content walk instead of
    // being dropped. It still costs nothing: no usage block, no tool_use blocks.
    const s = parseTranscript(
      SID,
      transcript([userLine(), assistantLine({ message: [] }), assistantLine()]),
    );
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0]?.model).toBe('unknown');
    expect(s.requests[0]?.input_tokens).toBe(0);
    expect(s.tokens.input).toBe(10);
    expect(s.tools).toEqual({});
  });

  it('counts an assistant message with no usage block as a zero-token request', () => {
    const s = parseTranscript(
      SID,
      transcript([userLine(), assistantLine({ message: { role: 'assistant', content: [] } })]),
    );
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]?.input_tokens).toBe(0);
    expect(s.requests[0]?.model).toBe('unknown');
    expect(s.tokens.input).toBe(0);
  });

  it('skips unparseable, blank and truncated lines', () => {
    const s = parseTranscript(
      SID,
      transcript([
        userLine(),
        '',
        '   ',
        'not json at all',
        '{"type":"assistant","sessionId":"' + SID + '","messa',
        assistantLine(),
      ]),
    );
    expect(s.requests).toHaveLength(1);
    expect(s.prompts).toHaveLength(1);
  });

  it('ignores events belonging to a different session id', () => {
    const s = parseTranscript(
      SID,
      transcript([
        userLine(),
        assistantLine(),
        assistantLine({ sessionId: '11111111-1111-1111-1111-111111111111' }),
      ]),
    );
    expect(s.requests).toHaveLength(1);
    expect(s.tokens.input).toBe(10);
  });

  it('does not treat sidechain or non-string user messages as prompts', () => {
    const s = parseTranscript(
      SID,
      transcript([
        userLine(),
        userLine({ promptId: 'p2', isSidechain: true }),
        userLine({ promptId: 'p3', message: { role: 'user', content: [{ type: 'text' }] } }),
        userLine({ promptId: 'p1' }), // duplicate promptId
      ]),
    );
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]?.idx).toBe(0);
  });

  it('lets unknown event types advance timestamps, cwd and cli version', () => {
    const s = parseTranscript(
      SID,
      transcript([
        line({
          type: 'summary',
          sessionId: SID,
          timestamp: '2026-05-24T10:00:00.000Z',
          cwd: '/tmp/proj',
          version: '9.9.9',
        }),
        userLine(),
        assistantLine(),
      ]),
    );
    expect(s.started_at).toBe('2026-05-24T10:00:00.000Z');
    expect(s.cli_version).toBe('9.9.9');
    expect(s.path_hash).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('finalize guards', () => {
  it('throws when cwd was never observed', () => {
    const state = newState(SID);
    applyLine(state, line({ type: 'user', sessionId: SID, timestamp: '2026-05-24T11:00:00.000Z' }));
    expect(() => finalize(state)).toThrow(AggregatorIncompleteError);
    expect(() => finalize(state)).toThrow(/path_hash/);
  });

  it('throws when no line carried a timestamp', () => {
    const state = newState(SID);
    applyLine(state, line({ type: 'user', sessionId: SID, cwd: '/tmp/proj' }));
    expect(() => finalize(state)).toThrow(/timestamps/);
  });

  it('falls back to the scanner-supplied cwd when the transcript has none', () => {
    const withoutCwd = transcript([
      line({
        type: 'user',
        sessionId: SID,
        promptId: 'p1',
        timestamp: '2026-05-24T11:00:00.000Z',
        message: { role: 'user', content: 'hi' },
      }),
    ]);
    const fallback = parseTranscript(SID, withoutCwd, {
      fallbackCwd: '/tmp/proj',
      includeProjectName: true,
    });
    const observed = parseTranscript(SID, transcript([userLine()]), { includeProjectName: true });
    // Same hash either way, so a rescued session lands in the same project.
    expect(fallback.path_hash).toBe(observed.path_hash);
    expect(fallback.project_name).toBe('proj');
  });
});
