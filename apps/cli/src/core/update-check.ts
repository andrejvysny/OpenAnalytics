import consola from 'consola';
import { basename } from 'node:path';
import { loadConfig, saveConfig } from './config';
import { VERSION } from '../version';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REPO = 'andrejvysny/OpenAnalytics';

// Fire-and-forget; never throws. Logs a one-line hint if a newer release is available.
// Skipped on Windows and when running from source via bun.
export function maybeNotifyUpdate(): void {
  if (process.platform === 'win32') return;
  if (basename(process.execPath).startsWith('bun')) return;
  const cfg = loadConfig();
  const last = cfg.lastUpdateCheckAt ? Date.parse(cfg.lastUpdateCheckAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < CHECK_INTERVAL_MS) return;

  void (async () => {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { 'User-Agent': 'oa-cli', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return;
      const j = (await r.json()) as { tag_name?: string };
      const remote = j.tag_name?.replace(/^v/, '');
      if (remote && remote !== VERSION) {
        consola.info(`oa ${j.tag_name} available (current v${VERSION}) — run \`oa update\``);
      }
      saveConfig({ ...cfg, lastUpdateCheckAt: new Date().toISOString() });
    } catch {
      // best-effort; swallow network/parse errors
    }
  })();
}
