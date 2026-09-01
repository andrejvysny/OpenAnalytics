import { describe, expect, it } from 'vitest';
import { diffForToolUse } from './diff.js';

describe('diffForToolUse', () => {
  it('counts lines for Write', () => {
    const d = diffForToolUse('Write', { file_path: '/tmp/a.ts', content: 'one\ntwo\nthree' });
    expect(d).toEqual({ added: 3, removed: 0, ext: 'ts' });
  });

  it('counts both for Edit', () => {
    const d = diffForToolUse('Edit', {
      file_path: '/tmp/x.py',
      old_string: 'a\nb',
      new_string: 'a\nB\nc\nd',
    });
    expect(d).toEqual({ added: 4, removed: 2, ext: 'py' });
  });

  it('returns null for non-diff tools', () => {
    expect(diffForToolUse('Read', { file_path: '/tmp/x.ts' })).toBeNull();
    expect(diffForToolUse('Bash', { command: 'ls' })).toBeNull();
  });

  it('handles missing extension', () => {
    const d = diffForToolUse('Write', { file_path: '/tmp/Makefile', content: 'all:\n\t@true\n' });
    expect(d?.ext).toBeNull();
  });

  it('trailing newline does not add phantom line', () => {
    const d = diffForToolUse('Write', { file_path: '/x.md', content: 'a\nb\n' });
    expect(d?.added).toBe(2);
  });

  it('counts both sources for NotebookEdit', () => {
    const d = diffForToolUse('NotebookEdit', {
      file_path: '/nb/analysis.ipynb',
      old_source: 'import os\nprint(1)',
      new_source: 'import os\nimport sys\nprint(2)',
    });
    expect(d).toEqual({ added: 3, removed: 2, ext: 'ipynb' });
  });

  it('treats a NotebookEdit cell insert (no old_source) as pure additions', () => {
    const d = diffForToolUse('NotebookEdit', {
      file_path: '/nb/a.ipynb',
      new_source: 'x = 1',
    });
    expect(d).toEqual({ added: 1, removed: 0, ext: 'ipynb' });
  });

  it('counts missing or non-string inputs as zero rather than throwing', () => {
    expect(diffForToolUse('Write', { file_path: '/a.ts' })).toEqual({
      added: 0,
      removed: 0,
      ext: 'ts',
    });
    expect(diffForToolUse('Edit', { file_path: '/a.ts', old_string: 5, new_string: null })).toEqual(
      {
        added: 0,
        removed: 0,
        ext: 'ts',
      },
    );
  });

  it('returns null when there is no input at all', () => {
    expect(diffForToolUse('Write', undefined)).toBeNull();
  });
});

describe('diffForToolUse — extension extraction', () => {
  const cases: Array<[path: unknown, ext: string | null]> = [
    // A leading dot is the whole basename, not an extension.
    ['/home/dev/.env', null],
    ['.gitignore', null],
    // Only the last segment after the final dot counts.
    ['/src/api.test.ts', 'ts'],
    ['/src/archive.tar.gz', 'gz'],
    // Normalized to lower case so `.TS` and `.ts` aggregate together.
    ['/src/Component.TSX', 'tsx'],
    ['/SRC/MAIN.PY', 'py'],
    // Windows separators resolve to the same basename.
    ['C:\\Users\\dev\\proj\\main.rs', 'rs'],
    ['C:\\Users\\dev\\Makefile', null],
    // A directory dot must not leak into a file with no extension.
    ['/home/dev/.config/openanalytics/notes', null],
    // Degenerate inputs.
    ['/src/trailing.', null],
    ['', null],
    [undefined, null],
    [42, null],
  ];

  for (const [path, ext] of cases) {
    it(`${JSON.stringify(path)} -> ${ext}`, () => {
      expect(diffForToolUse('Write', { file_path: path, content: 'a' })?.ext).toBe(ext);
    });
  }
});
