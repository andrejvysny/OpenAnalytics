# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpenAnalytics is a self-hostable, metadata-only analytics tool for AI coding agents (Claude Code today; schema is multi-agent ready). A local CLI (`oa`) parses session transcripts and syncs **metadata only** to a cloud API + Next.js dashboard, with shared-plan cost splitting across teams. AGPL-3.0.

> `AGENTS.md` (repo shape + commands), `DEPLOYMENT.md` (full env reference), and `docs/CLI.md` are companion docs — consult them for detail not repeated here.
> `vibenal/` and `vibenalytics/` are **reference-only** Rust projects, NOT part of this monorepo. Ignore them unless porting the `fnv1aHex` path-hash (which must stay bit-exact with `vibenal/src/hash.rs`).

## Layout

pnpm monorepo (`pnpm@10.33.2`, Node 22, Bun 1.3.6). Workspaces: `apps/*`, `packages/*`.

- `apps/cli` — `oa` CLI. TS run/compiled by **Bun**, shipped as single binaries (`bun build --compile`).
- `apps/api` — **Hono** server on Bun + **Drizzle** ORM. Entry `src/index.ts`.
- `apps/web` — **Next.js 15** App Router, server-rendered, custom SVG charts.
- `packages/parser` (`@oa/parser`) — JSONL → `Session` aggregator + path hashing. Vitest, snapshot-tested.
- `packages/schema` (`@oa/schema`) — **Zod contracts**, the single source of truth shared by CLI and API.
- `packages/db` (`@oa/db`) — Drizzle schema + SQL migrations.

Dependency direction: `cli → parser, schema`; `api → db, schema`; `parser → schema`. Schema is the contract both ends validate against.

## Commands

```bash
# Install (matches CI/Docker — intentional despite committed lockfile)
pnpm install --frozen-lockfile=false

# CI parity (run before pushing)
pnpm -r typecheck
pnpm --filter @oa/parser test

# Focused parser test
pnpm --filter @oa/parser exec vitest run src/adapters/claude-code/diff.test.ts

# CLI has Bun tests but NO package `test` script — run directly
pnpm --filter @oa/cli exec bun test src/core/scan.test.ts

# Lint is web-only: root `pnpm -r lint` delegates to apps/web `next lint`
pnpm -r lint

# DB (Drizzle reads DATABASE_URL, defaults to postgres://oa:oa@localhost:5432/oa)
pnpm --filter @oa/db generate   # emit a new journaled migration from schema diff
pnpm --filter @oa/db migrate    # apply pending journaled migrations (dev AND prod)
pnpm --filter @oa/db push       # DEV ONLY: push schema directly (never used in prod)

# Build CLI release binaries (5 targets)
pnpm --filter @oa/cli compile:darwin-arm64   # …darwin-x64, linux-x64, linux-arm64, windows-x64
```

`apps/api` has no test runner; `@oa/parser` is the only package with a `test` script (so `pnpm -r test` only runs parser).

## Dev vs Prod (two different compose files)

- **Dev: `docker-compose.yml`** — `docker compose up` → Postgres + API (`bun --watch` on `:3001`) + web (`next dev` on `:3000`) + MailDev (`:1080`). Source is bind-mounted; both hot-reload. Bootstrap a user + API key once: `docker compose exec api bun apps/api/scripts/dev-bootstrap.ts`.
- **Prod: `compose.yml`** — `docker compose -f compose.yml up -d` pulls GHCR images, fronts API/web with **Caddy** (auto-TLS). `docker/api-entrypoint.sh` waits for Postgres, runs `drizzle-kit migrate` (journaled, non-destructive — **never** `push --force`), then seeds model prices. Skip those with `OA_SKIP_MIGRATIONS=1` / `OA_SKIP_SEED=1`. Migrations live in `packages/db/migrations` (squashed `0000_baseline`); add new ones with `pnpm --filter @oa/db generate`.

## Data flow (end to end)

```
~/.claude/projects/**/*.jsonl
   │  CLI: discoverTranscripts → parseTranscript (per-line aggregator)
   ▼
Session (Zod) — metadata only, path_hash not raw path
   │  cursors.json gates re-parse; sync batches ≤50; POST /api/sync (Bearer API key)
   ▼
api ingestSessions (one transaction) → cost computed AT INGEST from model_prices
   ▼
Postgres: sessions + requests + prompts + tool_usage + language_diffs (+ projects upsert)
   ▼
Next.js dashboard (server components) ── session-cookie auth ──► api read routes
```

**Parser** (`packages/parser/src/adapters/claude-code/`): `aggregate.ts` is a per-line state machine accumulating tokens (incl. 5m/1h cache split, reasoning, extra), tool counts, prompt/request metadata; `finalize()` emits an immutable `Session` and throws `AggregatorIncompleteError` if `path_hash`/timestamps are missing. `diff.ts` derives lines added/removed **by file extension** from Write/Edit/NotebookEdit inputs (never content). `usage-events.ts` parses per-request token events across agents (claude-code/codex/opencode/gemini) for the local `oa usage` command and request-level billing.

**Two auth schemes in the API**: API-key (`middleware/auth-api-key.ts`) guards only `/api/sync` — token is `oa_live_…`, only the prefix is indexed, the secret is argon2id-hashed (`services/crypto.ts`). Everything else uses session cookies (`oa_session`, 30-day, `middleware/auth-session.ts`).

**Cost is computed once at ingest** (`services/ingest.ts` + `pricing.ts`) and stored on `sessions.cost_usd` + `cost_breakdown` (jsonb). Re-ingesting the same `session_id` fully replaces the session and its child rows (idempotent). Shared-plan splits (`services/billing.ts`, `plans.ts`, `routes/plan.ts`) attribute per-request cost across members over the billing cycle, honoring each member's `tracking_from`.

## Invariants — do not break

- **Metadata only.** Never add prompt text, file contents, bash commands, or raw paths to sync payloads or the `Session` schema. The whole pipeline is built on this. Prompts carry count + length only.
- **Path hashing.** Synced `path_hash` is `HMAC-SHA256(salt, cwd)[:16]` where salt = workspaceSalt ?? apiKey ?? machineId (`apps/cli/src/core/privacy.ts`). The parser default `fnv1aHex` (`packages/parser/src/hash.ts`) is overridden by the CLI; keep `fnv1aHex` bit-exact with the Rust reference if touched.
- **Default privacy.** Project basename is sent by default (`sendProjectName: true`); opt out with `oa login --no-send-project-name`. Raw hostname is opt-in (`--send-hostname`); otherwise the anonymous `machineId` is reported.
- **Prices must be seeded before ingest.** Missing `model_prices` rows ⇒ cost silently computes to 0 (warns once). After adding/changing a model's price, run `apps/api/scripts/recompute-costs.ts` to backfill existing rows. Model names are normalized leniently (version suffixes, `anthropic/` prefix, `[1m]`, `<synthetic>` → Opus).
- **Cursor durability.** Sync advances `cursors.json` only after every batch is fully accepted; partial acceptance throws so the next run retries from the same offset.
- **CLI state** lives in `$XDG_CONFIG_HOME/openanalytics` or `~/.config/openanalytics` (`config.json`, `cursors.json`, `sync.lock`); transcripts read from `~/.claude/projects`. `queue.jsonl` is currently vestigial.

## Web ↔ API wiring

- Server components fetch via `apps/web/lib/api.ts`: server-side uses `INTERNAL_API_URL` (Docker DNS `http://api:3001`) and falls back to `NEXT_PUBLIC_API_URL`. Auth cookies are forwarded manually (`lib/auth-actions.ts`).
- `NEXT_PUBLIC_API_URL` is **baked at build time** in the web Docker image — changing it at runtime requires a rebuild.
- Next config: `output: 'standalone'`, `outputFileTracingRoot` set to repo root so workspace packages are traced into the standalone bundle.

## Conventions

- TS base (`tsconfig.base.json`) is strict with `noUncheckedIndexedAccess`, `isolatedModules`, `verbatimModuleSyntax`. No `any`. API/CLI use Bun types. Keep functions <50 lines, files <500.
- Prettier: semicolons, single quotes, trailing commas, print width 100. EditorConfig: LF, 2 spaces, final newline.
- Schema changes go in `packages/schema` first, then ripple to parser/api/db — it is the shared contract.
