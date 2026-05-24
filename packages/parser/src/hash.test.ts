import { describe, expect, it } from 'vitest';
import { fnv1aHex } from './hash.js';

describe('fnv1aHex', () => {
  it('matches known FNV-1a 64-bit vectors', () => {
    // Empty string → FNV offset basis.
    expect(fnv1aHex('')).toBe('cbf29ce484222325');
    // Reference vector for "a" per the FNV spec (64-bit).
    expect(fnv1aHex('a')).toBe('af63dc4c8601ec8c');
    // Reference vector for "foobar".
    expect(fnv1aHex('foobar')).toBe('85944171f73967e8');
  });

  it('produces 16-char lowercase hex', () => {
    const h = fnv1aHex('/Users/andrej/workspace/openanalytics');
    expect(h).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic', () => {
    const a = fnv1aHex('/some/path');
    const b = fnv1aHex('/some/path');
    expect(a).toBe(b);
  });

  it('differs for different inputs', () => {
    expect(fnv1aHex('/a')).not.toBe(fnv1aHex('/b'));
  });
});
