import { createHmac } from 'node:crypto';
import type { CliConfig } from './config';

export interface ParserPrivacyOptions {
  hashPath: (path: string) => string;
  includeProjectName: boolean;
  reportedHost: string;
}

export function parserPrivacyOptions(cfg: CliConfig): ParserPrivacyOptions {
  const salt = cfg.workspaceSalt ?? cfg.apiKey ?? cfg.machineId;
  return {
    hashPath: (path) => hmac16(salt, path),
    includeProjectName: cfg.sendProjectName,
    reportedHost: cfg.sendHostname ? cfg.host : cfg.machineId,
  };
}

function hmac16(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 16);
}
