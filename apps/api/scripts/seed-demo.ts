#!/usr/bin/env bun
// Seed synthetic sessions for local UI validation. Idempotent (uses fixed session ids).
//
// Usage:
//   DATABASE_URL=... USER_EMAIL=dev@oa.local bun apps/api/scripts/seed-demo.ts

import { createDb, schema } from '@oa/db';
import { and, eq } from 'drizzle-orm';
import type { Session } from '@oa/schema';
import { ingestSessions } from '../src/services/ingest';
import { getOrCreatePersonalWorkspace } from '../src/services/workspace';

const URL = process.env.DATABASE_URL ?? 'postgres://oa:oa@localhost:5432/oa';
const EMAIL = process.env.USER_EMAIL ?? 'dev@oa.local';
const db = createDb(URL);

const [u] = await db.select().from(schema.users).where(eq(schema.users.email, EMAIL)).limit(1);
if (!u) throw new Error(`no user with email ${EMAIL}`);
const userId = u.id;
const wsId = await getOrCreatePersonalWorkspace(db, userId);
console.log('workspace', wsId);

// 14 days of fake usage across 5 projects.
const PROJECTS = ['openpcb', 'OpenAnalytics', 'spendly', 'exam', 'smve'];
const MODELS = [
  { model: 'claude-opus-4-7', weight: 0.6 },
  { model: 'claude-sonnet-4-6', weight: 0.3 },
  { model: 'claude-haiku-4-5', weight: 0.1 },
];

function pickModel() {
  const r = Math.random();
  let acc = 0;
  for (const m of MODELS) {
    acc += m.weight;
    if (r < acc) return m.model;
  }
  return MODELS[0]!.model;
}

function pathHashHex(seed: string): string {
  // 16-hex char path_hash — uses a deterministic mock so re-runs upsert the same rows.
  let h = 0xcbf29ce484222325n;
  for (const c of seed) h = (h ^ BigInt(c.charCodeAt(0))) * 0x100000001b3n;
  return (h & 0xffffffffffffffffn).toString(16).padStart(16, '0').slice(0, 16);
}

const sessions: Session[] = [];
const now = Date.now();
const dayMs = 86_400_000;
let counter = 0;

for (let d = 13; d >= 0; d--) {
  const dayStart = now - d * dayMs;
  const sessionsToday = 1 + Math.floor(Math.random() * 4);
  for (let s = 0; s < sessionsToday; s++) {
    counter++;
    const project = PROJECTS[Math.floor(Math.random() * PROJECTS.length)]!;
    const model = pickModel();
    const start = new Date(dayStart + Math.random() * dayMs * 0.8);
    const durationS = 60 + Math.floor(Math.random() * 1800);
    const end = new Date(start.getTime() + durationS * 1000);
    const reqCount = 3 + Math.floor(Math.random() * 12);
    const baseInput = 200 + Math.floor(Math.random() * 800);
    const baseOutput = 800 + Math.floor(Math.random() * 4000);
    const cacheRead = 80_000 + Math.floor(Math.random() * 400_000);
    const cacheCreation5m = 5_000 + Math.floor(Math.random() * 30_000);
    const cacheCreation1h = Math.random() < 0.3 ? 2_000 + Math.floor(Math.random() * 10_000) : 0;
    const tools: Record<string, number> = {
      Read: 2 + Math.floor(Math.random() * 8),
      Edit: Math.floor(Math.random() * 6),
      Bash: 1 + Math.floor(Math.random() * 4),
      Write: Math.floor(Math.random() * 3),
    };
    const linesAdded = 30 + Math.floor(Math.random() * 400);
    const linesRemoved = Math.floor(Math.random() * Math.max(linesAdded / 3, 1));
    const exts: Record<string, { added: number; removed: number }> = {
      ts: { added: Math.floor(linesAdded * 0.6), removed: Math.floor(linesRemoved * 0.6) },
      tsx: { added: Math.floor(linesAdded * 0.3), removed: Math.floor(linesRemoved * 0.3) },
      md: { added: Math.floor(linesAdded * 0.1), removed: 0 },
    };
    const session: Session = {
      agent_kind: 'claude-code',
      session_id: `00000000-0000-0000-0000-${counter.toString(16).padStart(12, '0')}`,
      path_hash: pathHashHex(project),
      project_name: project,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      model,
      cli_version: '1.0.0',
      tokens: {
        input: baseInput * reqCount,
        output: baseOutput * reqCount,
        cache_read: cacheRead,
        cache_creation: cacheCreation5m + cacheCreation1h,
        cache_creation_5m: cacheCreation5m,
        cache_creation_1h: cacheCreation1h,
        reasoning: 0,
      },
      lines_added: linesAdded,
      lines_removed: linesRemoved,
      lines_by_extension: exts,
      tools,
      prompts: Array.from({ length: reqCount }, (_, i) => ({
        idx: i,
        ts: new Date(
          start.getTime() + (i * (end.getTime() - start.getTime())) / reqCount,
        ).toISOString(),
        length: 50 + Math.floor(Math.random() * 400),
        request_count: 1,
        command: null,
        skills: [],
      })),
      requests: Array.from({ length: reqCount }, (_, i) => ({
        prompt_idx: i,
        ts: new Date(
          start.getTime() + (i * (end.getTime() - start.getTime())) / reqCount,
        ).toISOString(),
        model,
        input_tokens: baseInput,
        output_tokens: baseOutput,
        cache_read_tokens: Math.floor(cacheRead / reqCount),
        cache_creation_tokens: Math.floor((cacheCreation5m + cacheCreation1h) / reqCount),
        cache_creation_5m_tokens: Math.floor(cacheCreation5m / reqCount),
        cache_creation_1h_tokens: Math.floor(cacheCreation1h / reqCount),
        lines_added: Math.floor(linesAdded / reqCount),
        lines_removed: Math.floor(linesRemoved / reqCount),
      })),
      subagents: {},
    };
    sessions.push(session);
  }
}

console.log(`inserting ${sessions.length} sessions…`);
const r = await ingestSessions(db, userId, wsId, sessions);
console.log(`accepted=${r.accepted} ignored=${r.ignored}`);

// Bump plan to Claude Max 5x so the over-budget UI is exercised.
await db
  .update(schema.workspaces)
  .set({
    planKind: 'max_5x',
    planName: 'Claude Max 5x',
    monthlyPriceUsd: '100.00',
    monthlyBudgetUsd: 100,
    billingCycleDay: 26,
  })
  .where(eq(schema.workspaces.id, wsId));
console.log('set plan: max_5x · $100/mo · day 26');

// Suppress unused import warning when adapter shape changes.
void and;
process.exit(0);
