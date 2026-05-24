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
    expect(session.project_name).toBe('proj');
    expect(JSON.stringify(session)).not.toContain('/Users/test');
  });

  it('captures token totals', () => {
    expect(session.tokens.input).toBe(28);
    expect(session.tokens.output).toBe(55);
    expect(session.tokens.cache_read).toBe(55);
    expect(session.tokens.cache_creation).toBe(100);
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
