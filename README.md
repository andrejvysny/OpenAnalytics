# OpenAnalytics

Open-source, self-hostable analytics for AI coding agents — a free alternative to vibenalytics.dev.

- **Local daemon** (`oa`) reads Claude Code session transcripts from `~/.claude/projects/` and syncs metadata only (no prompt text, no file contents, no raw paths — full paths never leave the machine, but the project folder **name** is sent by default; opt out with `--no-send-project-name`).
- **Cloud API + dashboard** stores usage per user across multiple machines and shows per-project, per-day, per-tool, per-language breakdowns.
- **Shared plans** let teams pool a Claude subscription and see a **per-member percentage split** of cost and usage across the billing cycle.
- **AGPL-3.0**, single-machine signup, docker-compose, no telemetry, no email required in v1.

> Status: **v0.1.0 — minimal working demo.**

---

## Install `oa` CLI

Current release (`v0.1.0`) ships binaries but not the release-hosted installer yet. Until `v0.1.1`, install from the repo script:

```bash
curl -fsSL https://raw.githubusercontent.com/andrejvysny/OpenAnalytics/master/scripts/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
oa --version
```

Then connect it to your OpenAnalytics server:

```bash
oa login --api-url https://openanalytics.andrejvysny.sk --api-key oa_live_...
oa import          # backfill existing Claude Code transcripts
oa service install # run daemon in background on macOS/Linux
oa service status
```

If installing from a local checkout:

```bash
sh scripts/install.sh
```

After `v0.1.1`, the preferred verified installer will be:

```bash
curl -fsSL https://github.com/andrejvysny/OpenAnalytics/releases/latest/download/install.sh | sh
```

---

## Quickstart

### Production (Docker, all batteries included)

```bash
git clone https://github.com/andrejvysny/OpenAnalytics.git && cd OpenAnalytics
cp .env.example .env       # edit SESSION_SECRET, POSTGRES_PASSWORD, CADDY_DOMAIN, …
docker compose -f compose.yml up -d
```

Visit `https://<your-domain>` (or `https://localhost` if `CADDY_DOMAIN=localhost`). Caddy fronts api + web with auto-TLS via Let's Encrypt.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for full env reference, reverse-proxy notes, multi-machine usage, backups.

### Development (hot reload, in containers)

```bash
git clone https://github.com/andrejvysny/OpenAnalytics.git && cd OpenAnalytics
docker compose up    # postgres + api (bun --watch) + web (next dev)
```

API on `http://localhost:3001`, web on `http://localhost:3000`. Source is bind-mounted; both servers hot-reload on save.

Bootstrap a dev user once:

```bash
docker compose exec api bun apps/api/scripts/dev-bootstrap.ts
```

That prints an API key. Use it from a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/andrejvysny/OpenAnalytics/master/scripts/install.sh | sh
oa login --api-url http://localhost:3001 --api-key oa_live_…
oa import          # backfill ~/.claude/projects/
oa daemon          # initial sync, then watch continuously
```

Refresh `http://localhost:3000` — your Overview now shows live data.

## What gets shipped to the server

Per Claude Code session (one row in `sessions` table):

- `session_id` (uuid from transcript filename)
- `path_hash` (workspace-salted HMAC of cwd — **never the raw path**)
- `started_at` / `ended_at`, `model`, `cli_version`, machine id (`host` field)
- Tokens: input / output / cache_read / cache_creation
- Lines added/removed, broken down by file extension only
- Tool call counts (`Bash: 19, Write: 47, …`)
- Prompts: count + character length only (**never the text**)
- Per-request token deltas

No prompts, no file paths, no bash commands, and no file contents leave your machine. The project folder **name** (not the full path) is sent by default — opt out with `--no-send-project-name`.

## Multi-machine

Each machine gets its own API key (`oa_live_…`) and reports a random per-install machine id. Raw hostname is not sent unless explicitly enabled in config.

## Shared-plan comparison

1. Owner: **Settings → Workspaces → Create workspace** (set monthly budget).
2. Owner: **Create invite link** → copy URL → send to teammates out-of-band.
3. Teammates sign up, open the link, click Accept.
4. Each teammate runs `oa login --workspace <workspace-id>` with their API key.
5. `/plan/<id>` shows per-member percent split, dollar amounts, sessions, prompts, line diffs across the current billing cycle, with a stacked daily-cost chart.

## Architecture

```
~/.claude/projects/**/*.jsonl
        │  (chokidar watcher, durable cursors)
        ▼
oa  ──── POST /api/sync ────►  Hono (Bun)  ────►  Postgres 16
                                  │
                                  ▼
                              Next.js 15 dashboard
```

- **`apps/cli`** — TypeScript, compiled to a single binary via `bun build --compile`.
- **`apps/api`** — Hono + Drizzle ORM.
- **`apps/web`** — Next.js 15 App Router, server-rendered, custom SVG charts.
- **`packages/parser`** — pure-TS jsonl parser + privacy-aware path hashing + aggregator state machine. Snapshot-tested.
- **`packages/schema`** — Zod contracts shared between CLI and API.
- **`packages/db`** — Drizzle schema + migrations.

## CLI distribution (Phase I)

Tagged releases ship 5 binaries (`darwin-{arm64,x64}`, `linux-{arm64,x64}`, `windows-x64`) plus `SHA256SUMS` and `install.sh` via the `release-cli.yml` GitHub Actions workflow. The installer downloads from GitHub Releases and verifies SHA256 before replacing `oa`:

```bash
curl -fsSL https://github.com/andrejvysny/OpenAnalytics/releases/latest/download/install.sh | sh
```

## Run `oa daemon` as a background service

**macOS (launchd):** run `oa service install` to write and load `~/Library/LaunchAgents/dev.openanalytics.daemon.plist`.

**Linux (systemd user):** run `oa service install` to write `~/.config/systemd/user/oa-daemon.service` and enable it with `systemctl --user`.

Use `oa service status` and `oa service uninstall` to inspect/remove the service.

## Limitations in v0.1

- No outbound email: password reset is via admin shell (`bun apps/api/scripts/dev-bootstrap.ts`); invites are shareable links only.
- Subagent transcripts are merged into the parent session.
- One agent type (Claude Code). Schema is multi-agent ready (`agent_kind`).
- Costs computed at ingest time using a versioned `model_prices` table — pricing rows for new Anthropic models must be added before sessions on those models cost correctly.

## License

AGPL-3.0-only. See `LICENSE`.
