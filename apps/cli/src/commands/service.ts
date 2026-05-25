// `oa service install/uninstall/status` — register/unregister `oa daemon` as a
// background service (launchd on macOS, systemd --user on Linux). Best-effort;
// prints manual instructions on Windows.

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import consola from 'consola';

const EXE = process.execPath;

function darwinPlistPath(): string {
  return join(homedir(), 'Library/LaunchAgents/dev.openanalytics.daemon.plist');
}

function darwinPlist(): string {
  const logDir = join(homedir(), '.local/state');
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, 'oa-daemon.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.openanalytics.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${EXE}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

function linuxUnitPath(): string {
  return join(homedir(), '.config/systemd/user/oa-daemon.service');
}

function linuxUnit(): string {
  return `[Unit]
Description=OpenAnalytics daemon — sync Claude Code session metrics
After=network-online.target

[Service]
Type=simple
ExecStart=${EXE} daemon
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

export function runServiceInstall(): void {
  switch (platform()) {
    case 'darwin': {
      const path = darwinPlistPath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, darwinPlist());
      spawnSync('launchctl', ['unload', path], { stdio: 'ignore' });
      const r = spawnSync('launchctl', ['load', '-w', path], { stdio: 'inherit' });
      if (r.status !== 0) {
        consola.error('launchctl load failed');
        process.exit(1);
      }
      consola.success(`launchd service installed: ${path}`);
      consola.info(`logs: tail -f ${join(homedir(), '.local/state/oa-daemon.log')}`);
      break;
    }
    case 'linux': {
      const path = linuxUnitPath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, linuxUnit());
      runOrDie('systemctl', ['--user', 'daemon-reload']);
      runOrDie('systemctl', ['--user', 'enable', '--now', 'oa-daemon']);
      consola.success(`systemd user service installed: ${path}`);
      consola.info('logs: journalctl --user -u oa-daemon -f');
      consola.info("hint: 'loginctl enable-linger $USER' keeps the service");
      consola.info('       running even when no shell session is open.');
      break;
    }
    case 'win32':
      consola.warn('Windows service install not automated. Try NSSM:');
      consola.info(`  nssm install OADaemon ${EXE} daemon`);
      break;
    default:
      consola.error(`unsupported platform: ${platform()}`);
      process.exit(1);
  }
}

export function runServiceUninstall(): void {
  switch (platform()) {
    case 'darwin': {
      const path = darwinPlistPath();
      if (existsSync(path)) {
        spawnSync('launchctl', ['unload', path], { stdio: 'ignore' });
        unlinkSync(path);
        consola.success(`removed ${path}`);
      } else {
        consola.info('launchd service not installed');
      }
      break;
    }
    case 'linux': {
      const path = linuxUnitPath();
      if (existsSync(path)) {
        spawnSync('systemctl', ['--user', 'disable', '--now', 'oa-daemon'], {
          stdio: 'inherit',
        });
        unlinkSync(path);
        spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
        consola.success(`removed ${path}`);
      } else {
        consola.info('systemd service not installed');
      }
      break;
    }
    default:
      consola.warn('uninstall not implemented for this platform');
  }
}

export function runServiceStatus(): void {
  switch (platform()) {
    case 'darwin': {
      const path = darwinPlistPath();
      consola.info(`plist: ${existsSync(path) ? path : '(not installed)'}`);
      if (existsSync(path)) {
        execAndShow('launchctl', ['list', 'dev.openanalytics.daemon']);
      }
      break;
    }
    case 'linux': {
      const path = linuxUnitPath();
      consola.info(`unit: ${existsSync(path) ? path : '(not installed)'}`);
      if (existsSync(path)) {
        execAndShow('systemctl', ['--user', 'status', 'oa-daemon', '--no-pager']);
      }
      break;
    }
    default:
      consola.warn('status not implemented for this platform');
  }
}

// Restart a managed daemon service if one is installed. Best-effort.
// Returns { restarted: true } on success, { restarted: false } if no service
// is installed for the current platform, or { restarted: false, note } if a
// service is installed but the restart command failed.
export function restartService(): { restarted: boolean; note?: string } {
  switch (platform()) {
    case 'darwin': {
      const path = darwinPlistPath();
      if (!existsSync(path)) return { restarted: false };
      const uid = process.getuid?.();
      if (typeof uid === 'number') {
        const k = spawnSync(
          'launchctl',
          ['kickstart', '-k', `gui/${uid}/dev.openanalytics.daemon`],
          { stdio: 'ignore' },
        );
        if (k.status === 0) return { restarted: true };
      }
      // Fallback for older launchd: unload + load
      spawnSync('launchctl', ['unload', path], { stdio: 'ignore' });
      const r = spawnSync('launchctl', ['load', '-w', path], { stdio: 'ignore' });
      return r.status === 0
        ? { restarted: true }
        : { restarted: false, note: 'launchctl restart failed' };
    }
    case 'linux': {
      const path = linuxUnitPath();
      if (!existsSync(path)) return { restarted: false };
      const r = spawnSync('systemctl', ['--user', 'restart', 'oa-daemon'], {
        stdio: 'ignore',
      });
      return r.status === 0
        ? { restarted: true }
        : { restarted: false, note: 'systemctl restart failed' };
    }
    default:
      return { restarted: false };
  }
}

function runOrDie(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    consola.error(`${cmd} ${args.join(' ')} failed`);
    process.exit(1);
  }
}

function execAndShow(cmd: string, args: string[]): void {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8' });
    console.log(out.trim());
  } catch (err) {
    console.log((err as Error).message);
  }
}
