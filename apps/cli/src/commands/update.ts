import { createHash } from 'node:crypto';
import { chmodSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import consola from 'consola';
import { VERSION } from '../version';
import { restartService } from './service';

const REPO = 'andrejvysny/OpenAnalytics';

export interface UpdateOpts {
  check?: boolean;
}

export async function runUpdate(opts: UpdateOpts = {}): Promise<void> {
  if (basename(process.execPath).startsWith('bun')) {
    consola.info('Running from source (bun); update via `git pull` instead.');
    return;
  }
  if (process.platform === 'win32') {
    consola.error('Self-update on Windows not supported; re-run install.sh.');
    process.exit(1);
  }
  const asset = platformAsset();
  if (!asset) {
    consola.error(`unsupported platform: ${process.platform}/${process.arch}`);
    process.exit(1);
  }

  consola.info(`Current version: v${VERSION}`);
  let tag: string;
  try {
    tag = await fetchLatestTag();
  } catch (err) {
    consola.error(`failed to check for updates: ${(err as Error).message}`);
    process.exit(1);
  }
  const remote = tag.replace(/^v/, '');
  if (remote === VERSION) {
    consola.success(`Already up to date (v${VERSION}).`);
    return;
  }
  consola.info(`New version available: ${tag}`);
  if (opts.check) return;

  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  let bin: Buffer;
  let sums: string;
  try {
    [bin, sums] = await Promise.all([
      fetchBinary(`${base}/${asset}`),
      fetchText(`${base}/SHA256SUMS`),
    ]);
  } catch (err) {
    consola.error(`download failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const expected = parseSums(sums, asset);
  if (!expected) {
    consola.error(`SHA256SUMS missing entry for ${asset}`);
    process.exit(1);
  }
  const actual = createHash('sha256').update(bin).digest('hex');
  if (actual !== expected) {
    consola.error(`checksum mismatch (expected ${expected}, got ${actual})`);
    process.exit(1);
  }

  const target = process.execPath;
  const tmp = `${target}.update.tmp`;
  try {
    writeFileSync(tmp, bin);
    chmodSync(tmp, 0o755);
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      consola.error(`permission denied writing ${target}.`);
      consola.info(`Try: sudo install -m 755 ${tmp} ${target}`);
    } else {
      consola.error((err as Error).message);
    }
    process.exit(1);
  }

  consola.success(`Updated to ${tag}.`);
  const svc = restartService();
  if (svc.restarted) {
    consola.success('Restarted managed daemon service.');
  } else if (svc.note) {
    consola.warn(`${svc.note}. Restart your daemon manually.`);
  } else {
    consola.info('Restart `oa daemon` to run the new binary.');
  }
}

function platformAsset(): string | null {
  const os =
    process.platform === 'darwin'
      ? 'darwin'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform === 'win32'
          ? 'windows'
          : null;
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  if (!os || !arch) return null;
  return `oa-${os}-${arch}${os === 'windows' ? '.exe' : ''}`;
}

async function fetchLatestTag(): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      'User-Agent': 'oa-cli',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!r.ok) throw new Error(`GitHub API: ${r.status}`);
  const j = (await r.json()) as { tag_name?: string };
  if (!j.tag_name) throw new Error('no tag_name in release');
  return j.tag_name;
}

async function fetchBinary(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { 'User-Agent': 'oa-cli' } });
  if (!r.ok) throw new Error(`download ${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': 'oa-cli' } });
  if (!r.ok) throw new Error(`download ${url}: ${r.status}`);
  return r.text();
}

function parseSums(sums: string, asset: string): string | null {
  for (const line of sums.split('\n')) {
    const m = line.match(/^([a-f0-9]+)\s+(\S+)$/);
    if (m && m[2] === asset) return m[1]!;
  }
  return null;
}
