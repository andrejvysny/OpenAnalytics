# OpenAnalytics

Open-source, self-hostable analytics for AI coding agents — a free alternative to vibenalytics.dev.

- **Local daemon** (`oa`) reads Claude Code session transcripts from `~/.claude/projects/` and syncs metadata only (no prompt text, no file contents, no raw paths).
- **Cloud API + dashboard** stores usage per user across multiple machines and shows per-project, per-day, per-tool, per-language breakdowns.
- **Shared plans** let teams pool a Claude subscription and see a **per-member percentage split** of cost and usage across the billing cycle.
- **AGPL-3.0**, single-machine signup, docker-compose, no telemetry, no email required in v1.

> Status: **v0.1.0 — minimal working demo.**

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
oa daemon          # watch + sync continuously
```

Refresh `http://localhost:3000` — your Overview now shows live data.

## What gets shipped to the server

Per Claude Code session (one row in `sessions` table):

- `session_id` (uuid from transcript filename)
- `path_hash` (FNV-1a of cwd — **never the raw path**)
- `started_at` / `ended_at`, `model`, `cli_version`, `host`
- Tokens: input / output / cache_read / cache_creation
- Lines added/removed, broken down by file extension only
- Tool call counts (`Bash: 19, Write: 47, …`)
- Prompts: count + character length only (**never the text**)
- Per-request token deltas

No prompts, no file paths, no bash commands, no file contents leave your machine.

## Multi-machine

Each machine gets its own API key (`oa_live_…`) and reports `host = hostname`. The server natural-keys sessions by their UUID, so the same user pushing from two laptops sees one unified Overview / Explore / Plan view.

## Shared-plan comparison

1. Owner: **Settings → Workspaces → Create workspace** (set monthly budget).
2. Owner: **Create invite link** → copy URL → send to teammates out-of-band.
3. Teammates sign up, open the link, click Accept.
4. Each teammate runs `oa workspace set <slug>` (or pass `--workspace` at login).
5. `/plan/<id>` shows per-member percent split, dollar amounts, sessions, prompts, line diffs across the current billing cycle, with a stacked daily-cost chart.

## Architecture

```
~/.claude/projects/**/*.jsonl
        │  (chokidar watcher, byte-offset cursors)
        ▼
oa  ──── POST /api/sync ────►  Hono (Bun)  ────►  Postgres 16
                                  │
                                  ▼
                              Next.js 15 dashboard
```

- **`apps/cli`** — TypeScript, compiled to a single binary via `bun build --compile`.
- **`apps/api`** — Hono + Drizzle ORM.
- **`apps/web`** — Next.js 15 App Router, server-rendered, custom SVG charts.
- **`packages/parser`** — pure-TS jsonl parser + FNV-1a hasher + aggregator state machine. Snapshot-tested.
- **`packages/schema`** — Zod contracts shared between CLI and API.
- **`packages/db`** — Drizzle schema + migrations.

## CLI distribution (Phase I)

Tagged releases ship 5 binaries (`darwin-{arm64,x64}`, `linux-{arm64,x64}`, `windows-x64`) via the `release-cli.yml` GitHub Actions workflow. Users install with:

```bash
curl -fsSL https://raw.githubusercontent.com/andrejvysny/OpenAnalytics/master/scripts/install.sh | sh
```

## Run `oa daemon` as a background service

**macOS (launchd):** drop a `~/Library/LaunchAgents/dev.openanalytics.daemon.plist` referencing `oa daemon` with `RunAtLoad` + `KeepAlive`, then `launchctl load …`.

**Linux (systemd user):** `~/.config/systemd/user/oa-daemon.service` running `ExecStart=%h/.local/bin/oa daemon`, then `systemctl --user enable --now oa-daemon`.

A first-class `oa service install` command lands in v0.2.

## Limitations in v0.1

- No outbound email: password reset is via admin shell (`bun apps/api/scripts/dev-bootstrap.ts`); invites are shareable links only.
- No subagent transcripts yet (only top-level `<uuid>.jsonl` files).
- One agent type (Claude Code). Schema is multi-agent ready (`agent_kind`).
- Costs computed at ingest time using a versioned `model_prices` table — pricing rows for new Anthropic models must be added before sessions on those models cost correctly.

## License

AGPL-3.0-only. See `LICENSE`.
