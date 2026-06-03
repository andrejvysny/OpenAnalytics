import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cursorsPath } from './config';

// Per-path sync watermark. Stores combined (parent+subagents) byte size AND mtime so
// we re-sync not just on growth but also on truncation/rotation (size shrank) or any
// content change at the same size (mtime advanced). Re-parse is always full-file.
export interface CursorEntry {
  size: number;
  mtimeMs: number;
}
export type Cursors = Record<string, CursorEntry>;

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export function loadCursors(): Cursors {
  const p = cursorsPath();
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    const out: Cursors = {};
    for (const [path, v] of Object.entries(raw)) {
      // Legacy format stored a bare byte-size number; migrate to {size, mtimeMs:0}.
      if (typeof v === 'number') {
        out[path] = { size: v, mtimeMs: 0 };
      } else if (v && typeof v === 'object' && typeof (v as CursorEntry).size === 'number') {
        const e = v as CursorEntry;
        out[path] = { size: e.size, mtimeMs: Number(e.mtimeMs) || 0 };
      }
    }
    return out;
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

// A file needs (re-)sync when never seen, when its combined size changed in either
// direction (growth, or truncation/rotation), or when its mtime advanced past the
// last sync watermark.
export function isPending(entry: CursorEntry | undefined, file: FileStat): boolean {
  if (!entry) return true;
  return file.size !== entry.size || file.mtimeMs > entry.mtimeMs;
}

export function markSynced(cursors: Cursors, path: string, file: FileStat): void {
  cursors[path] = { size: file.size, mtimeMs: file.mtimeMs };
}
