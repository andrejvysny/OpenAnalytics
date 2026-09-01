import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Bumped when defaults change in a way that needs to ignore stored values
// written by an older CLI. v1 introduced `sendProjectName: true` as the
// default — configs without `configVersion` had `false` written explicitly
// by v0.1.2 and earlier, and should be treated as "no user choice yet".
export const CONFIG_VERSION = 1;

export interface CliConfig {
  apiUrl: string;
  apiKey: string | null;
  workspaceId: string | null;
  host: string;
  machineId: string;
  sendHostname: boolean;
  sendProjectName: boolean;
  workspaceSalt: string | null;
  lastUpdateCheckAt: string | null;
  configVersion: number;
}

const APP = 'openanalytics';

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  const dir = join(base, APP);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

const CONFIG_FILE = 'config.json';
const CURSORS_FILE = 'cursors.json';

function configPath(): string {
  return join(configDir(), CONFIG_FILE);
}

export function loadConfig(): CliConfig {
  const p = configPath();
  if (!existsSync(p)) {
    return {
      apiUrl: process.env.OA_API_URL ?? 'http://localhost:3001',
      apiKey: null,
      workspaceId: null,
      host: hostname(),
      machineId: randomUUID(),
      sendHostname: false,
      sendProjectName: true,
      workspaceSalt: null,
      lastUpdateCheckAt: null,
      configVersion: CONFIG_VERSION,
    };
  }
  const data = JSON.parse(readFileSync(p, 'utf8')) as Partial<CliConfig>;
  // Configs written before v0.1.3 have no configVersion. v0.1.2 always wrote
  // sendProjectName explicitly (even if the user never opted out), so we
  // can't distinguish "user opted out" from "old default". Treat absent
  // configVersion as "no choice yet" and apply the new default-on.
  const migratingFromPreV1 = data.configVersion === undefined;
  return {
    apiUrl: data.apiUrl ?? process.env.OA_API_URL ?? 'http://localhost:3001',
    apiKey: data.apiKey ?? null,
    workspaceId: data.workspaceId ?? null,
    host: data.host ?? hostname(),
    machineId: data.machineId ?? randomUUID(),
    sendHostname: data.sendHostname === true,
    sendProjectName: migratingFromPreV1 ? true : data.sendProjectName !== false,
    workspaceSalt: data.workspaceSalt ?? null,
    lastUpdateCheckAt: data.lastUpdateCheckAt ?? null,
    configVersion: CONFIG_VERSION,
  };
}

export function saveConfig(cfg: CliConfig): void {
  const p = configPath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, p);
}

export function cursorsPath(): string {
  return join(configDir(), CURSORS_FILE);
}
