import consola from 'consola';
import chokidar from 'chokidar';
import { join } from 'node:path';
import { projectsDir } from '../core/config';
import { runSync } from './sync';

export async function runDaemon(): Promise<void> {
  const root = projectsDir();
  consola.info(`watching ${root}`);

  // Initial sync of everything pending.
  await runSync();

  // Debounced sync trigger.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let pendingAgain = false;

  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (syncing) {
        pendingAgain = true;
        return;
      }
      syncing = true;
      try {
        await runSync();
      } catch (err) {
        consola.error('sync failed:', (err as Error).message);
      } finally {
        syncing = false;
        if (pendingAgain) {
          pendingAgain = false;
          trigger();
        }
      }
    }, 1500);
  };

  const watcher = chokidar.watch(join(root, '*', '*.jsonl'), {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignoreInitial: true,
  });
  watcher.on('add', trigger).on('change', trigger);

  const shutdown = async () => {
    consola.info('shutting down…');
    await watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Idle keepalive — periodic safety sync every 5 min in case watcher misses something.
  setInterval(trigger, 5 * 60 * 1000);
}
