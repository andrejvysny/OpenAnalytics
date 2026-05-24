import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session } from '@oa/schema';
import { parseTranscript } from '../src/adapters/claude-code/parse.js';
import { fnv1aHex } from '../src/hash.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../__fixtures__/minimal.jsonl');

describe('claude-code aggregator (minimal fixture)', () => {
  const text = readFileSync(FIXTURE, 'utf8');
  const sid = '00000000-0000-0000-0000-000000000001';
  const session = parseTranscript(sid, text);

  it('validates against the @oa/schema Session', () => {
    expect(() => Session.parse(session)).not.toThrow();
  });

  it('hashes the working directory (never stores raw path)', () => {
    expect(session.path_hash).toBe(fnv1aHex('/Users/test/proj'));
    expect(session.project_name).toBeUndefined();
    expect(JSON.stringify(session)).not.toContain('/Users/test');
  });

  it('can opt into project basename for trusted local use', () => {
    const named = parseTranscript(sid, text, { includeProjectName: true });
    expect(named.project_name).toBe('proj');
  });

  it('captures token totals', () => {
    expect(session.tokens.input).toBe(28);
    expect(session.tokens.output).toBe(55);
    expect(session.tokens.cache_read).toBe(55);
    expect(session.tokens.cache_creation).toBe(100);
  });

  it('treats legacy cache_creation_input_tokens as 5m ephemeral', () => {
    // Minimal fixture only has the legacy flat field, so 5m=total, 1h=0.
    expect(session.tokens.cache_creation_5m).toBe(100);
    expect(session.tokens.cache_creation_1h).toBe(0);
  });

  it('reads nested cache_creation 5m / 1h split when provided', () => {
    const sid = '00000000-0000-0000-0000-000000000099';
    const events = [
      {
        type: 'user',
        sessionId: sid,
        promptId: 'p1',
        timestamp: '2026-05-24T11:00:00.000Z',
        cwd: '/tmp/x',
        message: { role: 'user', content: 'hi' },
      },
      {
        type: 'assistant',
        sessionId: sid,
        timestamp: '2026-05-24T11:00:01.000Z',
        cwd: '/tmp/x',
        version: '1.0.0',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [],
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 5,
            cache_creation: {
              ephemeral_5m_input_tokens: 40,
              ephemeral_1h_input_tokens: 60,
            },
          },
        },
      },
    ];
    const transcript = events.map((e) => JSON.stringify(e)).join('\n');
    const s = parseTranscript(sid, transcript);
    expect(s.tokens.cache_creation_5m).toBe(40);
    expect(s.tokens.cache_creation_1h).toBe(60);
    expect(s.tokens.cache_creation).toBe(100);
  });

  it('captures tool counts', () => {
    expect(session.tools).toEqual({ Write: 1, Edit: 1, Read: 1 });
  });

  it('computes line diffs and language breakdown', () => {
    // Write: 2 lines added. Edit: old=1 line, new=2 lines.
    expect(session.lines_added).toBe(4);
    expect(session.lines_removed).toBe(1);
    expect(session.lines_by_extension).toEqual({
      ts: { added: 4, removed: 1 },
    });
  });

  it('only counts real user prompts (string content + non-sidechain + promptId)', () => {
    expect(session.prompts).toHaveLength(2);
    expect(session.prompts[0]?.length).toBe('Hello world'.length);
    expect(session.prompts[1]?.length).toBe('second prompt'.length);
  });

  it('does not serialize prompt text, file contents, assistant text, or raw file paths', () => {
    const payload = JSON.stringify(session);
    expect(payload).not.toContain('Hello world');
    expect(payload).not.toContain('second prompt');
    expect(payload).not.toContain('console.log');
    expect(payload).not.toContain('sure');
    expect(payload).not.toContain('/Users/test');
    expect(payload).not.toContain('a.ts');
  });

  it('attaches requests to prompts', () => {
    // p1 has 2 assistant requests, p2 has 1.
    expect(session.prompts[0]?.request_count).toBe(2);
    expect(session.prompts[1]?.request_count).toBe(1);
    expect(session.requests).toHaveLength(3);
  });

  it('records model and CLI version', () => {
    expect(session.model).toBe('claude-opus-4-7');
    expect(session.cli_version).toBe('1.0.0');
  });

  it('sets timestamps to span the transcript', () => {
    expect(session.started_at).toBe('2026-05-24T10:00:00.000Z');
    expect(session.ended_at).toBe('2026-05-24T10:00:25.000Z');
  });
});
