import { password as bunPassword, randomUUIDv7 } from 'bun';
import { createHash } from 'node:crypto';

// SHA-256 hex. Used to store high-entropy tokens (password-reset) by hash, so a DB
// leak can't be replayed. argon2 is unnecessary here — the token is already 256-bit random.
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Bun's built-in argon2id. Defaults are sensible (m=64MiB, t=2, p=1).
export function hashPassword(plain: string): Promise<string> {
  return bunPassword.hash(plain, { algorithm: 'argon2id' });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return bunPassword.verify(plain, hash);
}

export function newId(): string {
  return randomUUIDv7();
}

// Generate `oa_live_<rand>` API key. The full string is the secret; only 11-char prefix is non-sensitive.
export function generateApiKey(): { full: string; prefix: string } {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const full = `oa_live_${hex}`;
  return { full, prefix: full.slice(0, 11) };
}
