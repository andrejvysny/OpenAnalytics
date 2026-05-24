import consola from 'consola';
import { loadConfig, saveConfig } from '../core/config';
import { loadCursors, saveCursors } from '../core/cursors';
import { discoverTranscripts, parseFile } from '../core/scan';
import { fetchWorkspaceSalt, postSync } from '../core/sync-client';
import { withSyncLock } from '../core/lock';
import { parserPrivacyOptions } from '../core/privacy';
import type { Session, SyncRequest } from '@oa/schema';

const BATCH = 50;

export interface ImportCommandOpts {
  dryRun?: boolean;
}

interface PendingSession {
  session: Session;
  path: string;
  size: number;
}

export async function runImport(opts: ImportCommandOpts = {}): Promise<void> {
  return withSyncLock(() => runImportUnlocked(opts));
}

async function runImportUnlocked(opts: ImportCommandOpts): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error('not logged in. Set OA_API_KEY or run `oa login --api-key <key>`.');
  }

  if (!cfg.workspaceSalt) {
    cfg.workspaceSalt = await fetchWorkspaceSalt({
      apiUrl: cfg.apiUrl,
      apiKey: cfg.apiKey,
      workspaceId: cfg.workspaceId,
    });
    saveConfig(cfg);
  }

  const privacy = parserPrivacyOptions(cfg);
  const files = discoverTranscripts();
  consola.info(`discovered ${files.length} transcript files`);
  if (files.length === 0) return;

  const cursors = loadCursors();
  const batch: PendingSession[] = [];
  let okCount = 0;
  let failCount = 0;
  let failed = false;

  const flush = async () => {
    if (batch.length === 0) return;
    const sessions = batch.map((item) => item.session);
    if (opts.dryRun) {
      const body: SyncRequest = { workspace_id: cfg.workspaceId, sessions };
      console.log(JSON.stringify(body, null, 2));
      batch.length = 0;
      return;
    }
    try {
      const r = await postSync(
        { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey!, workspaceId: cfg.workspaceId },
        sessions,
      );
      if (r.ignored > 0 || r.accepted !== sessions.length) {
        throw new Error(`partial sync rejected: accepted=${r.accepted} ignored=${r.ignored}`);
      }
      okCount += r.accepted;
      failCount += r.ignored;
      consola.success(`synced ${r.accepted} (${r.ignored} ignored)`);
    } catch (err) {
      failed = true;
      failCount += sessions.length;
      consola.error('sync batch failed:', (err as Error).message);
      return;
    }
    for (const item of batch) {
      cursors[item.path] = item.size;
    }
    batch.length = 0;
  };

  for (const f of files) {
    const s = parseFile(f, privacy);
    if (!s) continue;
    batch.push({ session: s, path: f.path, size: f.size });
    if (batch.length >= BATCH) await flush();
    if (failed) break;
  }
  await flush();
  if (failed) {
    consola.warn('import incomplete; cursors not advanced for failed batch');
    throw new Error('import failed');
  }
  if (opts.dryRun) return;
  saveCursors(cursors);
  saveConfig(cfg);
  consola.info(`done. accepted=${okCount} ignored=${failCount}`);
}
