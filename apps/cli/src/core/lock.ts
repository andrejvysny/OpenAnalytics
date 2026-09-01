import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { configDir } from './config';

const STALE_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

export function syncLockPath(): string {
  return join(configDir(), 'sync.lock');
}

export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const path = syncLockPath();
  acquireLock(path);
  const heartbeat = setInterval(() => touchLock(path), HEARTBEAT_MS);
  heartbeat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}

function touchLock(path: string): void {
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch {
    // lock file may have been removed concurrently; nothing to touch
  }
}

function acquireLock(path: string): void {
  if (existsSync(path) && isStale(path)) {
    try {
      unlinkSync(path);
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

// Stale iff the holder pid is dead (reclaim immediately) or the lock file's
// mtime (kept fresh by the heartbeat in withSyncLock) is older than STALE_MS.
function isStale(path: string): boolean {
  try {
    const pid = parseHolderPid(path);
    if (pid !== null && !isPidAlive(pid)) return true;
    const age = Date.now() - statSync(path).mtimeMs;
    return age > STALE_MS;
  } catch {
    // unreadable lock file: treat as stale so a corrupt lock can't wedge sync forever
    return true;
  }
}

function parseHolderPid(path: string): number | null {
  try {
    const firstLine = readFileSync(path, 'utf8').split('\n', 1)[0] ?? '';
    const pid = Number(firstLine.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
