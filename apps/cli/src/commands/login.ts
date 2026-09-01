import consola from 'consola';
import { loadConfig, saveConfig } from '../core/config';
import { fetchWorkspaceSalt } from '../core/sync-client';

export interface LoginOpts {
  apiKey?: string;
  apiUrl?: string;
  workspace?: string;
  sendHostname?: boolean;
  sendProjectName?: boolean;
  // commander auto-maps `--no-send-project-name` to this key (= false).
  // We keep both for clarity; explicit-false wins over explicit-true.
}

export async function runLogin(opts: LoginOpts): Promise<void> {
  const cfg = loadConfig();
  const previousApiUrl = cfg.apiUrl;
  const previousApiKey = cfg.apiKey;
  const previousWorkspaceId = cfg.workspaceId;
  if (opts.apiUrl) cfg.apiUrl = opts.apiUrl;
  if (opts.workspace) cfg.workspaceId = opts.workspace;
  if (opts.sendHostname === true) cfg.sendHostname = true;
  // Explicit-false from `--no-send-project-name` wins over the default-on.
  if (opts.sendProjectName === false) cfg.sendProjectName = false;
  else if (opts.sendProjectName === true) cfg.sendProjectName = true;

  if (opts.apiKey) {
    cfg.apiKey = opts.apiKey;
  } else {
    consola.error('browser OAuth flow not yet implemented. Pass --api-key <key> for now.');
    process.exit(1);
  }
  if (
    cfg.apiUrl !== previousApiUrl ||
    cfg.apiKey !== previousApiKey ||
    cfg.workspaceId !== previousWorkspaceId
  ) {
    cfg.workspaceSalt = null;
  }

  // Verify by hitting a cheap endpoint.
  const res = await fetch(`${cfg.apiUrl}/health`).catch(() => null);
  if (!res || !res.ok) {
    // Offline login is allowed (salt is fetched on first sync), but the key is unverified.
    consola.warn(`could not reach ${cfg.apiUrl} — saved credentials without verifying them`);
  } else {
    // The salt endpoint requires a valid key, so this doubles as key verification.
    // A 401/403 here means the key (or workspace) is wrong — refuse to save it.
    try {
      cfg.workspaceSalt = await fetchWorkspaceSalt({
        apiUrl: cfg.apiUrl,
        apiKey: cfg.apiKey,
        workspaceId: cfg.workspaceId,
      });
    } catch (e) {
      consola.error(`login failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }
  saveConfig(cfg);
  consola.success(`logged in. apiUrl=${cfg.apiUrl}`);
}
