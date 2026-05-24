import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cursorsPath } from './config';

export type Cursors = Record<string, number>; // absolute path → byte offset

export function loadCursors(): Cursors {
  const p = cursorsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Cursors;
  } catch {
    return {};
  }
}

export function saveCursors(c: Cursors): void {
  const p = cursorsPath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2));
  renameSync(tmp, p);
}
