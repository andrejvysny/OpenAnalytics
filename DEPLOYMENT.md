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

The api container runs migrations (`drizzle-kit push`) and seeds the model-prices table on first boot. Subsequent boots are idempotent.

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

| Variable              | Where | Required | Default                 | Notes                                       |
| --------------------- | ----- | -------- | ----------------------- | ------------------------------------------- |
| `DATABASE_URL`        | api   | ✓        | —                       | `postgres://user:pass@host:5432/db`         |
| `SESSION_SECRET`      | api   | ✓        | —                       | 32+ chars; rotate invalidates cookies       |
| `PUBLIC_WEB_URL`      | api   | ✓        | `http://localhost:3000` | Used for invite links + CORS                |
| `PUBLIC_API_URL`      | api   | ✓        | `http://localhost:3001` | Used for CLI bootstrap snippet              |
| `NEXT_PUBLIC_API_URL` | web   | ✓        | `http://localhost:3001` | Baked at build time **and** read at runtime |
| `NODE_ENV`            | both  | —        | `production`            |                                             |
| `TRUST_PROXY`         | api   | —        | `false`                 | Set `true` when behind reverse proxy        |
| `OA_SKIP_MIGRATIONS`  | api   | —        | `0`                     | Set `1` to manage schema externally         |
| `OA_SKIP_SEED`        | api   | —        | `0`                     | Set `1` to seed model_prices manually       |

## Multi-machine usage

Each user can have multiple API keys (one per machine). Sessions are natural-keyed by their UUID and scoped by `user_id`, so the same user pushing from N machines automatically merges into one unified view. The `host` column stores a random machine id by default; raw hostname is opt-in.

## Updates

```bash
docker compose -f compose.yml pull
docker compose -f compose.yml up -d
```

The api entrypoint reruns `drizzle-kit push` on every boot; new schema changes apply automatically.

## Backups

```bash
docker compose -f compose.yml exec postgres pg_dump -U oa oa | gzip > oa-$(date -I).sql.gz
```

## Releases & versioning

- `latest` tag follows `master`.
- Tagged releases ship the CLI binaries, `SHA256SUMS`, and `install.sh` as GitHub Release assets and tag the images accordingly.
- Docker images use immutable digests; pin in `compose.yml` for reproducible deploys.
