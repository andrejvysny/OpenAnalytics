import consola from 'consola';
import { loadConfig, saveConfig } from '../core/config';
import { loadCursors, saveCursors, markSynced } from '../core/cursors';
import { discoverTranscripts, parseFile } from '../core/scan';
import { sessionIssue } from '../core/validate';
import { fetchWorkspaceSalt, postSync, type SyncResult } from '../core/sync-client';
import { withSyncLock } from '../core/lock';
import { parserPrivacyOptions } from '../core/privacy';
import type { Session, SyncRequest } from '@oa/schema';

const BATCH = 50;

export interface ImportCommandOpts {
  dryRun?: boolean;
  // Ignore stored cursors and re-parse every discovered file. Useful for
  // backfilling fields (e.g. project_name) onto sessions ingested by an older
  // CLI version that didn't send them.
  force?: boolean;
}

interface PendingSession {
  session: Session;
  path: string;
  size: number;
  mtimeMs: number;
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

  // --force: start from a blank cursor map so every file is re-sent. The new
  // cursor file is rewritten at the end with the up-to-date sizes.
  const cursors = opts.force ? {} : loadCursors();
  if (opts.force) consola.info('force: ignoring stored cursors, re-importing everything');
  const batch: PendingSession[] = [];
  let okCount = 0;
  let quarantined = 0;
  let invalid = 0;
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
      transportFailed = true;
      consola.error('sync batch failed:', (err as Error).message);
      return;
    }
    const failedSet = new Set(r.failed);
    for (const item of batch) {
      if (failedSet.has(item.session.session_id)) {
        quarantined++;
        continue;
      }
      markSynced(cursors, item.path, item);
      okCount++;
    }
    consola.success(`synced ${r.accepted} (${r.failed.length} rejected)`);
    batch.length = 0;
  };

  for (const f of files) {
    const s = parseFile(f, privacy);
    if (!s) continue;
    // Schema-invalid sessions would 400 the whole batch server-side. Skip them and
    // advance the cursor so the same broken file isn't retried on every run.
    const issue = sessionIssue(s);
    if (issue) {
      consola.warn(`skipping invalid session ${f.path}: ${issue}`);
      markSynced(cursors, f.path, f);
      invalid++;
      continue;
    }
    batch.push({ session: s, path: f.path, size: f.size, mtimeMs: f.mtimeMs });
    if (batch.length >= BATCH) await flush();
    if (transportFailed) break;
  }
  await flush();
  if (opts.dryRun) return;
  saveCursors(cursors);
  saveConfig(cfg);
  if (transportFailed) {
    consola.warn('import incomplete (transport error); re-run to resume');
    throw new Error('import failed');
  }
  consola.info(`done. accepted=${okCount} quarantined=${quarantined} invalid=${invalid}`);
}
