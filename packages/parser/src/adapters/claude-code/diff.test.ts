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
});
