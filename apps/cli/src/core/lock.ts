import { closeSync, existsSync, openSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './config';

const STALE_MS = 10 * 60 * 1000;

export function syncLockPath(): string {
  return join(configDir(), 'sync.lock');
}

export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const path = syncLockPath();
  acquireLock(path);
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}

function acquireLock(path: string): void {
  if (existsSync(path)) {
    try {
      const age = Date.now() - statSync(path).mtimeMs;
      if (age > STALE_MS) unlinkSync(path);
    } catch {
      // ignore and try acquiring below
    }
  }

  let fd: number | null = null;
  try {
    fd = openSync(path, 'wx', 0o600);
    writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
  } catch {
    throw new Error('another oa sync is already running');
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
