import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface CliConfig {
  apiUrl: string;
  apiKey: string | null;
  workspaceId: string | null;
  host: string;
  machineId: string;
  sendHostname: boolean;
  sendProjectName: boolean;
  workspaceSalt: string | null;
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
const QUEUE_FILE = 'queue.jsonl';

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
      sendProjectName: false,
      workspaceSalt: null,
    };
  }
  const data = JSON.parse(readFileSync(p, 'utf8')) as Partial<CliConfig>;
  return {
    apiUrl: data.apiUrl ?? process.env.OA_API_URL ?? 'http://localhost:3001',
    apiKey: data.apiKey ?? null,
    workspaceId: data.workspaceId ?? null,
    host: data.host ?? hostname(),
    machineId: data.machineId ?? randomUUID(),
    sendHostname: data.sendHostname === true,
    sendProjectName: data.sendProjectName === true,
    workspaceSalt: data.workspaceSalt ?? null,
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

export function queuePath(): string {
  return join(configDir(), QUEUE_FILE);
}
