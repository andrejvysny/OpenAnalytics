import consola from 'consola';
import { loadConfig, saveConfig } from '../core/config';
import { loadCursors, saveCursors } from '../core/cursors';
import { discoverTranscripts, parseFile } from '../core/scan';
import { postSync } from '../core/sync-client';
import type { Session } from '@oa/schema';

const BATCH = 50;

export async function runImport(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    consola.error('not logged in. Set OA_API_KEY or run `oa login --api-key <key>`.');
    process.exit(1);
  }

  const files = discoverTranscripts();
  consola.info(`discovered ${files.length} transcript files`);
  if (files.length === 0) return;

  const cursors = loadCursors();
  const batch: Session[] = [];
  let okCount = 0;
  let failCount = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    try {
      const r = await postSync(
        { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey!, workspaceId: cfg.workspaceId },
        batch,
      );
      okCount += r.accepted;
      failCount += r.ignored;
      consola.success(`synced ${r.accepted} (${r.ignored} ignored)`);
    } catch (err) {
      failCount += batch.length;
      consola.error('sync batch failed:', (err as Error).message);
    }
    batch.length = 0;
  };

  for (const f of files) {
    const s = parseFile(f, cfg.host);
    if (!s) continue;
    batch.push(s);
    cursors[f.path] = f.size; // mark fully read
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  saveCursors(cursors);
  saveConfig(cfg);
  consola.info(`done. accepted=${okCount} ignored=${failCount}`);
}
