import consola from 'consola';
import { loadConfig, configDir } from '../core/config';
import { loadCursors } from '../core/cursors';
import { discoverTranscripts } from '../core/scan';

export function runStatus(): void {
  const cfg = loadConfig();
  const cursors = loadCursors();
  const files = discoverTranscripts();
  const pending = files.filter((f) => (cursors[f.path] ?? 0) < f.size);
  consola.info('config dir:  ', configDir());
  consola.info('api url:     ', cfg.apiUrl);
  consola.info('api key:     ', cfg.apiKey ? cfg.apiKey.slice(0, 11) + '…' : '(none)');
  consola.info('workspace:   ', cfg.workspaceId ?? '(personal)');
  consola.info('host:        ', cfg.host);
  consola.info(`transcripts: ${files.length} total, ${pending.length} pending sync`);
}
