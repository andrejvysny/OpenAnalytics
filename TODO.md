# OpenAnalytics — Implementation TODO

Track via tasks; this is the human-readable mirror.

## v0.1.0

- [x] Phase A — Repo skeleton
- [x] Phase B — Parser + aggregator
- [x] Phase C — DB schema + ingest
- [x] Phase D — Auth
- [x] Phase E — CLI
- [x] Phase F — Web auth + overview
- [x] Phase G — Web explore
- [x] Phase H — Workspaces + shared plan
- [x] Phase I — Polish + release

## v0.2 backlog

- Email adapter (verification, password reset, invite emails).
- Windows `oa service install/uninstall` automation (macOS/Linux done).
- `/insights` all-time page, `/projects` list + detail pages.
- Real-time timeline (SSE).
- GitHub README SVG embed.
- Streak counter, notifications, light theme.
- Multi-agent adapters (Codex, Cursor, Aider, OpenCode).

---

# Production-Readiness Remediation

Source: multi-agent review (security / token-correctness / performance / logic / deployment — every finding adversarially verified) + manual audit, 2026-06-03.
Verdict: **NOT production-ready as-is.** One critical (silent data loss on upgrade) + several correctness/security gaps. Foundations are solid; blockers are bounded and fixable.
Severity = adjusted (post-verification). "Latent" = correct mechanism, dormant today.

## Implementation status (2026-06-03)

**DONE** — all P0 (BLK-1..4), all P1, and most P2. `pnpm -r typecheck` clean; parser (31) + CLI (2) tests pass; full migration set verified on an ephemeral Postgres (idempotent, all tables + indexes + password_resets).

- BLK-1: switched prod to journaled `drizzle-kit migrate`; squashed migrations to `0000_baseline` (+ `0001_password_resets`); added `requests`/`prompts` indexes to schema.
- TOK-2 redefined `extra_total` as residual (+regression tests); TOK-1 subagent→request rows; `oa usage` UTC + human table output.
- Security: rate-limit + body-limit + Zod caps; session ownership guard; read-route membership checks; prod `SESSION_SECRET` guard; param validation + global `onError`; argon2 timing equalization.
- Ops: `/health` DB readiness + `/live`; graceful shutdown; pg pool timeouts + UTC; price `effectiveFrom` floor; billing-day clamp; transactional invite accept; `clientIp`/TRUST_PROXY; API version header; **PROD-11 password reset** (table + endpoints + web pages); CI runs CLI tests + migration check.

**DEFERRED (documented, low-risk)**:

- TOK-6 (pre-prompt promptIdx) & LOG-8 (`finalize` extra_total literal): verified inert (no consumer); left as-is.
- TOK-3/4 (hour-floored `requests.ts`): pending decision Q2 — left as-is (no current error).
- `next lint` not configured (no ESLint flat config) → not added to CI; needs `eslint.config.mjs` + `eslint-config-next`.
- BLK-2: kept "all of a member's usage" semantic per decision; documented in `plan.ts` + indexed.
- Multi-agent cloud ingest out of scope for v1 (per decision); `usage-events.ts` residual fix is in place for when it lands.

**ACTION REQUIRED before deploy**: the squashed baseline assumes a **fresh** prod DB. An existing DB created via `push` must be re-created (`docker compose -f compose.yml down -v`) or baselined into `drizzle.__drizzle_migrations` manually.

## P0 — Blockers (fix before ANY real or upgrade deploy)

- [ ] **BLK-1 (CRITICAL, data loss): `drizzle-kit push --force` will silently `TRUNCATE requests CASCADE` on next upgrade.** `ts_bucket` is `NOT NULL` no-default (`schema/sessions.ts:87`); drizzle prepends `truncate table "requests" cascade;` for that add on a populated table, `--force` (`docker/api-entrypoint.sh:32`) suppresses the prompt → all request rows wiped, exit 0. Compounding: `migrations/0001-0003` aren't journaled (`meta/_journal.json` has only `0000`) so `drizzle-kit migrate` never runs them; and `requests` defines **zero indexes in `schema.ts`** so push-built prod tables lack the `0003` indexes. Fix: move to journaled `drizzle-kit migrate` (preferred) OR give `ts_bucket` a default + guarded backfill AND add request indexes to `schema.ts`. Test upgrade on a populated DB clone.
- [ ] **BLK-2 (HIGH, billing correctness + perf): `/plan/:id/split` counts EVERY member's usage across ALL their workspaces (incl. personal).** `plan.ts:158-173,242-268` join sessions on `userId` only; no `eq(sessions.workspaceId, wsId)`. Fix: add the workspace filter to both queries (confirm semantics — see Q1).
- [ ] **BLK-3 (HIGH, sync stall): poison-pill session halts a machine's sync.** Server swallows per-session errors, returns `200 {ok:true,ignored}` (`ingest.ts:21-30`, `sync.ts:32`); CLI throws on `ignored>0` without advancing cursors (`sync.ts:69-71`). Fix: return failed `session_id`s / non-2xx so CLI can quarantine-and-advance.
- [ ] **BLK-4 (HIGH, availability/security): no rate limiting + no body-size cap.** `/auth/login` argon2 CPU-DoS + stuffing + timing oracle; `/auth/signup` 409 enumeration; `/api/sync` unbounded body + uncapped `prompts`/`requests` arrays. Fix: IP+account rate limit on `/auth/*`, per-key on `/sync`; `hono/body-limit`; `.max()` Zod caps; dummy argon2 on unknown user; generic responses.

## P1 — Before launch (or immediately after)

Token correctness (priority): **TOK-2** redefine `extra_total` to residual `max(0,total−components)` (`usage-events.ts:79,95,114,128` vs additive sums in `plan.ts`) — dormant double-count. **TOK-1** subagent tokens in session totals but not request rows (`scan.ts:123-147`) → plan/overview disagree. Finish `oa usage` (non-`--json` output + UTC vs local bucketing, `usage.ts:55,631`).

Security/integrity: **SEC-NEW** session upsert ownership guard (`ingest.ts:131`). **SEC-1** membership check on read routes; userId-scope `overview` top-projects (`overview.ts:74-87`). **SEC-4** refuse default `SESSION_SECRET` in prod (`env.ts:7`). **SEC-5/LOG-7** validate query params + global `onError`.

Deployment: **PROD-2** `/health` DB readiness (`SELECT 1`). **PROD-7** SIGTERM graceful shutdown. **PROD-4** price `effectiveFrom` floor (earlier sessions cost $0). **LOG-2** clamp `billingCycleDay` 29-31 (`billing.ts`). **LOG-4** transactional invite-accept. **LOG-6** pin pg `TimeZone:'UTC'`.

Performance: **PERF-1** sargable "today" range (`overview.ts:45`). **PERF-3** cap pricing memo maps. **PERF-4** prime price cache before `Promise.all`. **PERF-5** parallelize the 6-deep home fetch waterfall (`page.tsx:46-61`).

## P2 — Hardening / completeness

TOK-5/LOG-3 recompute `agentKind` hardcode; TOK-3/4 hour-floored `ts` (decide intent); TOK-6 pre-prompt `promptIdx`; LOG-5 cursor `(size,mtime)`; PROD-6 `TRUST_PROXY` unused; PROD-8 CLI version skew; PROD-11 dead password-reset; PROD-12 pg pool timeouts; PROD-10 AGPL §13 footer; CI: add CLI tests + lint + docker build smoke.

## Unresolved questions

1. Shared-plan split: only the shared workspace's usage, or all of a member's usage everywhere? (gates BLK-2)
2. Is hour-flooring `requests.ts` intentional (privacy) or an accident to revert? (TOK-3/4)
3. Migration: switch to journaled `drizzle-kit migrate`, or keep guarded `push --force`? (BLK-1)
4. `extra_total`: redefine to residual, or drop until multi-agent ingest exists? (TOK-2)
5. Multi-agent ingest (codex/opencode/gemini) in scope for v1, or is `oa usage` local-only the only multi-agent surface? (gates several latent items)
