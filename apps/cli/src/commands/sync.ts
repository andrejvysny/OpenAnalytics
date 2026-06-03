import consola from 'consola';
import { loadConfig, saveConfig } from '../core/config';
import { loadCursors, saveCursors, isPending, markSynced } from '../core/cursors';
import { discoverTranscripts, parseFile } from '../core/scan';
import { fetchWorkspaceSalt, postSync, type SyncResult } from '../core/sync-client';
import { withSyncLock } from '../core/lock';
import { parserPrivacyOptions } from '../core/privacy';
import { maybeNotifyUpdate } from '../core/update-check';
import type { Session, SyncRequest } from '@oa/schema';

const BATCH = 50;

export interface SyncCommandOpts {
  dryRun?: boolean;
}

interface PendingSession {
  session: Session;
  path: string;
  size: number;
  mtimeMs: number;
}

export async function runSync(opts: SyncCommandOpts = {}): Promise<void> {
  maybeNotifyUpdate();
  return withSyncLock(() => runSyncUnlocked(opts));
}

async function runSyncUnlocked(opts: SyncCommandOpts): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error('not logged in.');
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
  const cursors = loadCursors();
  const changed = files.filter((f) => isPending(cursors[f.path], f));
  consola.info(`${changed.length} files changed since last sync`);
  if (changed.length === 0) return;

  const batch: PendingSession[] = [];
  let ok = 0;
  let quarantined = 0;
  let transportFailed = false;

  const flush = async () => {
    if (batch.length === 0) return;
    const sessions = batch.map((item) => item.session);
    if (opts.dryRun) {
      const body: SyncRequest = { workspace_id: cfg.workspaceId, sessions };
      console.log(JSON.stringify(body, null, 2));
      batch.length = 0;
      return;
    }
    let r: SyncResult;
    try {
      r = await postSync(
        { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey!, workspaceId: cfg.workspaceId },
        sessions,
      );
    } catch (err) {
      // Transport failure (network / non-2xx after retries): stop and retry from the
      // same offset next run. Cursors advanced for earlier accepted batches persist below.
      transportFailed = true;
      consola.error('sync batch failed:', (err as Error).message);
      return;
    }
    // Advance cursors only for accepted sessions; server-rejected ones are quarantined
    // (left unadvanced → retried next run) so one poison-pill session can't stall all syncing.
    const failedSet = new Set(r.failed);
    for (const item of batch) {
      if (failedSet.has(item.session.session_id)) {
        quarantined++;
        continue;
      }
      markSynced(cursors, item.path, item);
      ok++;
    }
    if (r.failed.length > 0) {
      consola.warn(
        `${r.failed.length} session(s) rejected by server (will retry next run): ${r.failed.join(', ')}`,
      );
    }
    batch.length = 0;
  };

  for (const f of changed) {
    const s = parseFile(f, privacy);
    if (!s) continue;
    batch.push({ session: s, path: f.path, size: f.size, mtimeMs: f.mtimeMs });
    if (batch.length >= BATCH) await flush();
    if (transportFailed) break;
  }
  await flush();
  if (opts.dryRun) return;
  saveCursors(cursors);
  if (transportFailed) {
    consola.warn('sync incomplete (transport error); will resume next run');
    throw new Error('sync failed');
  }
  consola.info(`sync complete. accepted=${ok} quarantined=${quarantined}`);
}
