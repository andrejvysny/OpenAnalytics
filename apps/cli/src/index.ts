#!/usr/bin/env bun
import { Command } from 'commander';
import consola from 'consola';
import { runLogin } from './commands/login';
import { runDaemon } from './commands/daemon';
import { runSync } from './commands/sync';
import { runImport } from './commands/import';
import { runStatus } from './commands/status';
import { runServiceInstall, runServiceStatus, runServiceUninstall } from './commands/service';
import { runUpdate } from './commands/update';
import { runUsage } from './commands/usage';
import { VERSION } from './version';

const program = new Command();

program.name('oa').description('OpenAnalytics — track coding-agent usage locally').version(VERSION);

program
  .command('login')
  .description('Configure API URL and API key')
  .option('--api-url <url>', 'API base URL')
  .option('--api-key <key>', 'API key (oa_live_…)')
  .option('--workspace <id>', 'workspace id to attribute sessions to')
  .option('--send-hostname', 'Opt in to sending raw hostname')
  .option('--send-project-name', 'Opt in to sending raw project basename (default on)')
  .option('--no-send-project-name', 'Opt out of sending project basename')
  .action((opts) => runLogin(opts));

program
  .command('daemon')
  .description('Watch ~/.claude/projects/ and sync continuously')
  .action(() => runDaemon());

program
  .command('sync')
  .description('Sync new sessions once and exit')
  .option('--dry-run', 'Print payload without sending or advancing cursors')
  .action((opts) => runSync({ dryRun: opts.dryRun === true }));

program
  .command('import')
  .description('Backfill all historical sessions')
  .option('--dry-run', 'Print payload without sending or advancing cursors')
  .option('--force', 'Re-parse every transcript even if cursors say it is up to date')
  .action((opts) => runImport({ dryRun: opts.dryRun === true, force: opts.force === true }));

program
  .command('status')
  .description('Show config and pending-sync count')
  .action(() => runStatus());

const usage = program.command('usage').description('Show local usage summaries');
usage
  .command('daily')
  .description('Show daily local usage')
  .option('--agent <agent>', 'agent to summarize: claude, codex, opencode, gemini, all', 'claude')
  .option('-b, --breakdown', 'Include per-model breakdown')
  .option('--json', 'Print JSON')
  .option('-j', 'Print JSON')
  .action((opts) =>
    runUsage('daily', {
      agent: opts.agent,
      json: opts.json === true || opts.j === true,
      breakdown: opts.breakdown === true,
    }),
  );
usage
  .command('monthly')
  .description('Show monthly local usage')
  .option('--agent <agent>', 'agent to summarize: claude, codex, opencode, gemini, all', 'claude')
  .option('-b, --breakdown', 'Include per-model breakdown')
  .option('--json', 'Print JSON')
  .option('-j', 'Print JSON')
  .action((opts) =>
    runUsage('monthly', {
      agent: opts.agent,
      json: opts.json === true || opts.j === true,
      breakdown: opts.breakdown === true,
    }),
  );

const service = program
  .command('service')
  .description('Manage the daemon as a background service (launchd / systemd)');
service
  .command('install')
  .description('Register `oa daemon` to start at login + on reboot')
  .action(() => runServiceInstall());
service
  .command('uninstall')
  .description('Remove the registered background service')
  .action(() => runServiceUninstall());
service
  .command('status')
  .description('Show service status')
  .action(() => runServiceStatus());

program
  .command('update')
  .description('Update oa to the latest GitHub release')
  .option('--check', 'Check for a newer version without installing')
  .action((opts) => runUpdate({ check: opts.check === true }));

program.parseAsync().catch((err: unknown) => {
  consola.error((err as Error).message);
  process.exit(1);
});
