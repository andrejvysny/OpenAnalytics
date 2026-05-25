# AGENTS.md

## Repo shape

- pnpm monorepo (`apps/*`, `packages/*`), package manager pinned as `pnpm@10.33.2`; CI uses Node 22 and Bun 1.3.6.
- Runtime entrypoints: CLI `apps/cli/src/index.ts`, API `apps/api/src/index.ts`, web `apps/web/app/*` (Next App Router).
- Packages: `@oa/parser` parses Claude JSONL + hashes paths; `@oa/schema` holds Zod contracts; `@oa/db` holds Drizzle schema/migrations.

## Commands that matter

- Install like CI/Docker: `pnpm install --frozen-lockfile=false` (intentional despite committed lockfile).
- CI parity: `pnpm -r typecheck` then `pnpm --filter @oa/parser test`.
- Focus parser test: `pnpm --filter @oa/parser exec vitest run src/path/file.test.ts`.
- CLI has Bun tests but no package `test` script; run focused CLI tests with `pnpm --filter @oa/cli exec bun test src/core/scan.test.ts`.
- Lint is effectively web-only: root `pnpm -r lint` delegates to `apps/web` `next lint`.
- DB: `pnpm --filter @oa/db generate|migrate|push`; Drizzle reads `DATABASE_URL` or defaults to `postgres://oa:oa@localhost:5432/oa`.
- CLI release binaries: `pnpm --filter @oa/cli compile:darwin-arm64` etc. use `bun build --compile`.

## Local/dev/prod flow

- Dev stack is `docker-compose.yml`: `docker compose up` starts Postgres, API on `3001`, web on `3000`, MailDev on `1080`; bootstrap with `docker compose exec api bun apps/api/scripts/dev-bootstrap.ts`.
- Production stack is `compose.yml` (not `docker-compose.yml`): `docker compose -f compose.yml up -d` pulls GHCR images and fronts API/web with Caddy.
- API container entrypoint waits for Postgres, runs `drizzle-kit push --force`, then seeds model prices; set `OA_SKIP_MIGRATIONS=1` or `OA_SKIP_SEED=1` only when managing those externally.
- Web server-side fetches use `INTERNAL_API_URL` before `NEXT_PUBLIC_API_URL`; Docker sets this to `http://api:3001`.

## Privacy/data gotchas

- Never add prompt text, file contents, bash commands, or raw paths to sync payloads; parser/API are built around metadata-only ingest.
- Code currently sends project basename by default (`sendProjectName: true`); users opt out with `oa login --no-send-project-name`. Raw hostname remains opt-in with `--send-hostname`.
- CLI state lives in `$XDG_CONFIG_HOME/openanalytics` or `~/.config/openanalytics` (`config.json`, `cursors.json`, `queue.jsonl`); transcripts are read from `~/.claude/projects`.
- `.env.production` is ignored and may contain real secrets; do not commit or quote it.

## Style/config

- TS base config is strict with `noUncheckedIndexedAccess`, `isolatedModules`, and `verbatimModuleSyntax`; API/CLI use Bun types.
- Prettier: semicolons, single quotes, trailing commas, print width 100; EditorConfig uses LF, 2 spaces, final newline.
- Next config uses `output: 'standalone'` and traces from repo root (`outputFileTracingRoot: process.cwd() + '/../..'`).
