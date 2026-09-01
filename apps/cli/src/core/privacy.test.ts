import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { CliConfig } from './config';
import { parserPrivacyOptions } from './privacy';

function config(over: Partial<CliConfig> = {}): CliConfig {
  return {
    apiUrl: 'http://localhost:3001',
    apiKey: null,
    workspaceId: null,
    host: 'laptop.local',
    machineId: 'machine-abc',
    sendHostname: false,
    sendProjectName: true,
    workspaceSalt: null,
    lastUpdateCheckAt: null,
    configVersion: 1,
    ...over,
  };
}

// The synced path_hash contract: HMAC-SHA256(salt, cwd) truncated to 16 hex chars.
function expectedHash(salt: string, path: string): string {
  return createHmac('sha256', salt).update(path).digest('hex').slice(0, 16);
}

const CWD = '/Users/dev/workspace/secret-project';

describe('parserPrivacyOptions — salt precedence', () => {
  test('workspaceSalt wins over apiKey and machineId', () => {
    const opts = parserPrivacyOptions(
      config({ workspaceSalt: 'ws-salt', apiKey: 'oa_live_key', machineId: 'machine-abc' }),
    );
    expect(opts.hashPath(CWD)).toBe(expectedHash('ws-salt', CWD));
  });

  test('apiKey is used when no workspaceSalt has been fetched yet', () => {
    const opts = parserPrivacyOptions(
      config({ workspaceSalt: null, apiKey: 'oa_live_key', machineId: 'machine-abc' }),
    );
    expect(opts.hashPath(CWD)).toBe(expectedHash('oa_live_key', CWD));
  });

  test('machineId is the last resort for a logged-out CLI', () => {
    const opts = parserPrivacyOptions(
      config({ workspaceSalt: null, apiKey: null, machineId: 'machine-abc' }),
    );
    expect(opts.hashPath(CWD)).toBe(expectedHash('machine-abc', CWD));
  });

  test('each salt produces a different hash for the same path', () => {
    const hashes = new Set(
      [
        config({ workspaceSalt: 'ws-salt', apiKey: 'oa_live_key' }),
        config({ apiKey: 'oa_live_key' }),
        config(),
      ].map((c) => parserPrivacyOptions(c).hashPath(CWD)),
    );
    expect(hashes.size).toBe(3);
  });
});

describe('parserPrivacyOptions — hash shape', () => {
  test('always 16 lowercase hex chars, matching the Session.path_hash schema', () => {
    const opts = parserPrivacyOptions(config({ workspaceSalt: 'ws-salt' }));
    for (const path of [CWD, '/', 'C:\\Users\\dev\\proj', '', 'a'.repeat(4096)]) {
      expect(opts.hashPath(path)).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  test('is deterministic and never leaks the raw path', () => {
    const opts = parserPrivacyOptions(config({ workspaceSalt: 'ws-salt' }));
    expect(opts.hashPath(CWD)).toBe(opts.hashPath(CWD));
    expect(opts.hashPath(CWD)).not.toContain('secret-project');
  });

  test('distinct paths hash differently under the same salt', () => {
    const opts = parserPrivacyOptions(config({ workspaceSalt: 'ws-salt' }));
    expect(opts.hashPath('/a')).not.toBe(opts.hashPath('/b'));
  });
});

describe('parserPrivacyOptions — reported identity', () => {
  test('the anonymous machineId is reported unless hostname sharing is opted into', () => {
    expect(parserPrivacyOptions(config({ sendHostname: false })).reportedHost).toBe('machine-abc');
    expect(parserPrivacyOptions(config({ sendHostname: true })).reportedHost).toBe('laptop.local');
  });

  test('project name inclusion mirrors sendProjectName (default on)', () => {
    expect(parserPrivacyOptions(config()).includeProjectName).toBe(true);
    expect(parserPrivacyOptions(config({ sendProjectName: false })).includeProjectName).toBe(false);
  });
});
