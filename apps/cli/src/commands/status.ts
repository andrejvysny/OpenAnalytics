import consola from 'consola';
import { loadConfig, configDir } from '../core/config';
import { loadCursors, isPending } from '../core/cursors';
import { discoverTranscripts } from '../core/scan';

export function runStatus(): void {
  const cfg = loadConfig();
  const cursors = loadCursors();
  const files = discoverTranscripts();
  const pending = files.filter((f) => isPending(cursors[f.path], f));
  consola.info('config dir:  ', configDir());
  consola.info('api url:     ', cfg.apiUrl);
  consola.info('api key:     ', cfg.apiKey ? cfg.apiKey.slice(0, 11) + '…' : '(none)');
  consola.info('workspace:   ', cfg.workspaceId ?? '(personal)');
  consola.info('machine id:  ', cfg.machineId);
  consola.info('hostname:    ', cfg.sendHostname ? cfg.host : '(not sent)');
  consola.info('project name:', cfg.sendProjectName ? 'sent' : 'not sent');
  consola.info(`transcripts: ${files.length} total, ${pending.length} pending sync`);
}
