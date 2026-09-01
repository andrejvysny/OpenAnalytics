import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cursorsPath } from './config';
import { isPending, loadCursors, markSynced, saveCursors, type Cursors } from './cursors';

// Redirect CLI state to a scratch dir — these tests write real files and must never
// touch the developer's ~/.config/openanalytics.
const previousXdg = process.env.XDG_CONFIG_HOME;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'oa-cursors-'));
  process.env.XDG_CONFIG_HOME = root;
});

afterEach(() => {
  rmSync(cursorsPath(), { force: true });
  rmSync(`${cursorsPath()}.tmp`, { force: true });
});

afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(root, { recursive: true, force: true });
});

describe('isPending', () => {
  const entry = { size: 100, mtimeMs: 1_000 };

  test('a file never seen before is pending', () => {
    expect(isPending(undefined, { size: 0, mtimeMs: 0 })).toBe(true);
  });

  test('an unchanged file is not pending', () => {
    expect(isPending(entry, { size: 100, mtimeMs: 1_000 })).toBe(false);
  });

  test('growth makes a file pending', () => {
    expect(isPending(entry, { size: 101, mtimeMs: 1_000 })).toBe(true);
  });

  test('truncation / rotation makes a file pending even though it shrank', () => {
    expect(isPending(entry, { size: 5, mtimeMs: 1_000 })).toBe(true);
  });

  test('an advanced mtime at identical size makes a file pending', () => {
    expect(isPending(entry, { size: 100, mtimeMs: 1_001 })).toBe(true);
  });

  test('an older mtime at identical size does not', () => {
    expect(isPending(entry, { size: 100, mtimeMs: 999 })).toBe(false);
  });

  test('a legacy-migrated entry (mtimeMs 0) re-syncs on any mtime', () => {
    expect(isPending({ size: 100, mtimeMs: 0 }, { size: 100, mtimeMs: 1 })).toBe(true);
    // A file whose mtime is genuinely the epoch and whose size matches stays settled.
    expect(isPending({ size: 100, mtimeMs: 0 }, { size: 100, mtimeMs: 0 })).toBe(false);
  });
});

describe('loadCursors', () => {
  test('returns an empty map when the file does not exist', () => {
    expect(loadCursors()).toEqual({});
  });

  test('returns an empty map instead of throwing on corrupt JSON', () => {
    writeFileSync(cursorsPath(), '{not json');
    expect(loadCursors()).toEqual({});
  });

  test('migrates the legacy bare-number format to {size, mtimeMs: 0}', () => {
    writeFileSync(cursorsPath(), JSON.stringify({ '/a.jsonl': 4096 }));
    expect(loadCursors()).toEqual({ '/a.jsonl': { size: 4096, mtimeMs: 0 } });
  });

  test('coerces a missing or non-numeric mtimeMs to 0 and drops unusable entries', () => {
    writeFileSync(
      cursorsPath(),
      JSON.stringify({
        '/ok.jsonl': { size: 10, mtimeMs: 5 },
        '/no-mtime.jsonl': { size: 20 },
        '/bad-mtime.jsonl': { size: 30, mtimeMs: 'later' },
        '/no-size.jsonl': { mtimeMs: 5 },
        '/null.jsonl': null,
        '/string.jsonl': 'nope',
      }),
    );
    expect(loadCursors()).toEqual({
      '/ok.jsonl': { size: 10, mtimeMs: 5 },
      '/no-mtime.jsonl': { size: 20, mtimeMs: 0 },
      '/bad-mtime.jsonl': { size: 30, mtimeMs: 0 },
    });
  });
});

describe('saveCursors', () => {
  test('round-trips through loadCursors', () => {
    const cursors: Cursors = { '/a.jsonl': { size: 1, mtimeMs: 2 } };
    saveCursors(cursors);
    expect(loadCursors()).toEqual(cursors);
  });

  test('writes atomically: the temp file is renamed away, never left behind', () => {
    saveCursors({ '/a.jsonl': { size: 1, mtimeMs: 2 } });
    expect(existsSync(`${cursorsPath()}.tmp`)).toBe(false);
    expect(existsSync(cursorsPath())).toBe(true);
    // A complete JSON document — a half-written file would fail to parse.
    expect(() => JSON.parse(readFileSync(cursorsPath(), 'utf8'))).not.toThrow();
  });

  test('overwrites rather than merging with the previous contents', () => {
    saveCursors({ '/a.jsonl': { size: 1, mtimeMs: 2 } });
    saveCursors({ '/b.jsonl': { size: 3, mtimeMs: 4 } });
    expect(loadCursors()).toEqual({ '/b.jsonl': { size: 3, mtimeMs: 4 } });
  });
});

describe('markSynced', () => {
  test('records the observed stat so the file stops being pending', () => {
    const cursors: Cursors = {};
    const stat = { size: 512, mtimeMs: 99 };
    markSynced(cursors, '/a.jsonl', stat);
    expect(cursors['/a.jsonl']).toEqual(stat);
    expect(isPending(cursors['/a.jsonl'], stat)).toBe(false);
  });

  test('a mark survives a save/load round-trip', () => {
    const cursors: Cursors = {};
    markSynced(cursors, '/a.jsonl', { size: 7, mtimeMs: 8 });
    saveCursors(cursors);
    expect(isPending(loadCursors()['/a.jsonl'], { size: 7, mtimeMs: 8 })).toBe(false);
  });
});
