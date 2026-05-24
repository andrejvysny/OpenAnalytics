import consola from 'consola';
import { loadConfig, saveConfig } from '../core/config';

export interface LoginOpts {
  apiKey?: string;
  apiUrl?: string;
  workspace?: string;
}

export async function runLogin(opts: LoginOpts): Promise<void> {
  const cfg = loadConfig();
  if (opts.apiUrl) cfg.apiUrl = opts.apiUrl;
  if (opts.workspace) cfg.workspaceId = opts.workspace;

  if (opts.apiKey) {
    cfg.apiKey = opts.apiKey;
  } else {
    consola.error('browser OAuth flow not yet implemented. Pass --api-key <key> for now.');
    process.exit(1);
  }

  // Verify by hitting a cheap endpoint.
  const res = await fetch(`${cfg.apiUrl}/health`).catch(() => null);
  if (!res || !res.ok) {
    consola.warn(`could not reach ${cfg.apiUrl} (continuing anyway)`);
  }
  saveConfig(cfg);
  consola.success(`logged in. apiUrl=${cfg.apiUrl}`);
}
