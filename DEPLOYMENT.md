# Deployment

OpenAnalytics ships as **three container images** plus a **single-binary CLI**, all published to GitHub Container Registry (`ghcr.io`).

| Image                                   | Purpose                                    | Default port |
| --------------------------------------- | ------------------------------------------ | ------------ |
| `ghcr.io/andrejvysny/openanalytics-api` | Hono server, DB ingest, query API          | `3001`       |
| `ghcr.io/andrejvysny/openanalytics-web` | Next.js 15 dashboard                       | `3000`       |
| `ghcr.io/andrejvysny/openanalytics-cli` | Containerized `oa daemon` (optional)       | —            |
| `oa` (binary)                           | Local CLI for syncing Claude Code sessions | —            |

All images are multi-arch (`linux/amd64`, `linux/arm64`) and published publicly.

## Compose files

| File                 | Use                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml` | **Development.** Bind-mounts source, hot reload (Bun `--watch`, Next dev), local Postgres.                                                   |
| `compose.yml`        | **Production.** Pulls pre-built images from GHCR. Configured via `.env`. Includes Postgres by default; remove if you bring managed Postgres. |

## Quick install — production

```bash
git clone https://github.com/andrejvysny/OpenAnalytics.git && cd OpenAnalytics
cp .env.example .env
# Edit .env: set SESSION_SECRET (32+ chars), PUBLIC_WEB_URL, PUBLIC_API_URL
docker compose -f compose.yml up -d
```

The api container applies journaled migrations (`drizzle-kit migrate`) and seeds the model-prices table on first boot. Subsequent boots are idempotent and never destructive. Note: this expects a **fresh** database — migrations create the schema from the `0000_baseline`. To re-baseline an old dev DB created with `push`, recreate it (`docker compose down -v`).

First-run admin account creation:

```bash
docker compose -f compose.yml exec api bun apps/api/scripts/dev-bootstrap.ts admin@example.com 'strongPassword' 'Admin'
```

That prints the API key needed for the CLI.

## Quick install — CLI

```bash
curl -fsSL https://github.com/andrejvysny/OpenAnalytics/releases/latest/download/install.sh | sh
oa login --api-url https://oa.example.com --api-key oa_live_…
oa import         # backfill ~/.claude/projects/
oa daemon         # watch + sync continuously
```

Or via Docker:

```bash
docker run --rm -it \
  -v $HOME/.claude/projects:/root/.claude/projects:ro \
  -v oa-cli-state:/root/.config/openanalytics \
  -e OA_API_URL=https://oa.example.com \
  ghcr.io/andrejvysny/openanalytics-cli:latest login --api-key oa_live_…
```

## Reverse proxy & TLS

OpenAnalytics does not terminate TLS. Put Caddy / nginx / Traefik / Cloudflare Tunnel in front. Example Caddyfile:

```
oa.example.com {
  reverse_proxy /api/* api:3001
  reverse_proxy * web:3000
}
```

Set `TRUST_PROXY=true` in the API env so it honors `X-Forwarded-For` for rate limiting / IP capture.

## Required env vars

| Variable                | Where  | Required | Default                 | Notes                                                       |
| ----------------------- | ------ | -------- | ----------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`          | api    | ✓        | —                       | `postgres://user:pass@host:5432/db`                         |
| `SESSION_SECRET`        | api    | ✓        | —                       | 32+ chars; rotate invalidates cookies                       |
| `PUBLIC_WEB_URL`        | api    | ✓        | `http://localhost:3000` | Used for invite links + CORS                                |
| `PUBLIC_API_URL`        | api    | ✓        | `http://localhost:3001` | Used for CLI bootstrap snippet                              |
| `NEXT_PUBLIC_API_URL`   | web    | ✓        | `http://localhost:3001` | Baked at build time **and** read at runtime                 |
| `NODE_ENV`              | both   | —        | `production`            |                                                             |
| `TRUST_PROXY`           | api    | —        | `false`                 | Set `true` when behind reverse proxy                        |
| `OA_SKIP_MIGRATIONS`    | api    | —        | `0`                     | Set `1` to manage schema externally                         |
| `OA_SKIP_SEED`          | api    | —        | `0`                     | Set `1` to seed model_prices manually                       |
| `BACKUP_RETENTION_DAYS` | backup | —        | `14`                    | Days to keep daily Postgres dumps (see [Backups](#backups)) |

## Multi-machine usage

Each user can have multiple API keys (one per machine). Sessions are natural-keyed by their UUID and scoped by `user_id`, so the same user pushing from N machines automatically merges into one unified view. The `host` column stores a random machine id by default; raw hostname is opt-in.

## Updates

```bash
docker compose -f compose.yml pull
docker compose -f compose.yml up -d
```

The api entrypoint runs `drizzle-kit migrate` on every boot; only pending journaled migrations are applied (tracked in `__drizzle_migrations`), so upgrades are safe and additive.

### Pinning images

`OA_IMAGE_TAG` (in `.env`) controls which tag `compose.yml` pulls for `api`/`web`. `latest` follows `master` — fine for testing, not for reproducible prod deploys. For anything you care about staying stable, pin to an immutable build:

```bash
OA_IMAGE_TAG=sha-<short-commit-sha>
```

Find the sha tags for a given build on the GHCR package pages (`ghcr.io/andrejvysny/openanalytics-api`, `-web`). Tagged releases (e.g. `v0.1.0`) also work and are the more human-readable option. After changing `OA_IMAGE_TAG`, re-run the update commands above.

## Backups

`compose.yml` runs a `backup` sidecar (`postgres:16-alpine` + `docker/backup.sh`) alongside the bundled `postgres` service. It loops forever: dump, gzip, prune, sleep 24h — no host cron needed.

- **Where dumps land**: the named volume `oa-backups`, mounted at `/backups` in the `backup` container, as `oa-<YYYY-MM-DD>.sql.gz` (one per day; same-day reruns overwrite that day's file).
- **Retention**: `BACKUP_RETENTION_DAYS` in `.env` (default `14`). Dumps older than this are deleted on each loop iteration.
- **Requires** the bundled `postgres` service — if you brought your own managed Postgres (see the comment at the top of `compose.yml`), remove or repurpose `backup` too and back up via your DB provider instead.

### Restore

1. Stop the app so nothing writes during restore (leave `postgres` running):
   ```bash
   docker compose -f compose.yml stop api web caddy backup
   ```
2. Copy the dump out of the volume (or `docker cp` from the `backup` container) and restore into a **fresh** database — `sessions`/`requests`/ingest are keyed such that restoring over a live DB can conflict:
   ```bash
   docker compose -f compose.yml exec -T postgres dropdb -U oa oa --if-exists
   docker compose -f compose.yml exec -T postgres createdb -U oa oa
   gunzip -c oa-2026-08-01.sql.gz | docker compose -f compose.yml exec -T postgres psql -U oa oa
   ```
3. Bring everything back up:
   ```bash
   docker compose -f compose.yml up -d
   ```

### One-off dump

Bypass the sidecar's schedule and dump immediately:

```bash
docker compose -f compose.yml exec postgres pg_dump -U oa oa | gzip > oa-$(date -I).sql.gz
```

### Disabling

Comment out (or `docker compose -f compose.yml rm -sf backup`) the `backup` service in `compose.yml` if you back up Postgres another way (e.g. volume-level snapshots, a managed DB's own backups). The `oa-backups` volume is only written to by this sidecar and can be removed once unused.

## Releases & versioning

- `latest` tag follows `master`.
- Tagged releases ship the CLI binaries, `SHA256SUMS`, and `install.sh` as GitHub Release assets and tag the images accordingly.
- Docker images use immutable digests; pin in `compose.yml` for reproducible deploys.
