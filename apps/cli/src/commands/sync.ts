import consola from 'consola';
import { loadConfig } from '../core/config';
import { loadCursors, saveCursors } from '../core/cursors';
import { discoverTranscripts, parseFile } from '../core/scan';
import { postSync } from '../core/sync-client';
import type { Session } from '@oa/schema';

const BATCH = 50;

export async function runSync(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    consola.error('not logged in.');
    process.exit(1);
  }

  const files = discoverTranscripts();
  const cursors = loadCursors();
  const changed = files.filter((f) => (cursors[f.path] ?? 0) < f.size);
  consola.info(`${changed.length} files changed since last sync`);
  if (changed.length === 0) return;

  const batch: Session[] = [];
  let ok = 0;
  let bad = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    try {
      const r = await postSync(
        { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey!, workspaceId: cfg.workspaceId },
        batch,
      );
      ok += r.accepted;
      bad += r.ignored;
    } catch (err) {
      bad += batch.length;
      consola.error('sync batch failed:', (err as Error).message);
    }
    batch.length = 0;
  };

  for (const f of changed) {
    const s = parseFile(f, cfg.host);
    if (!s) continue;
    batch.push(s);
    cursors[f.path] = f.size;
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  saveCursors(cursors);
  consola.info(`sync complete. accepted=${ok} ignored=${bad}`);
}
