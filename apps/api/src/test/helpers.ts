// Shared fixtures for the DB-backed API tests. Safe to import from any test file:
// src/test/setup.ts (bunfig preload) has already pointed DATABASE_URL at oa_test and
// applied the journaled migrations by the time this module is evaluated.
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema } from '@oa/db';
import type { Session as SessionPayload } from '@oa/schema';
import { db } from '../db';
import { generateApiKey, hashPassword } from '../services/crypto';

export { db };

let tableCache: string[] | null = null;

// Every table in the public schema, discovered at runtime so a new migration can't
// silently leave stale rows behind. drizzle's bookkeeping lives in the `drizzle`
// schema and is deliberately out of reach.
async function appTables(): Promise<string[]> {
  if (tableCache) return tableCache;
  const rows = (await db.execute(
    sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  )) as unknown as Array<{ table_name: string }>;
  tableCache = rows.map((r) => r.table_name);
  return tableCache;
}

export async function truncateAll(): Promise<void> {
  // Belt-and-braces: setup.ts already refuses a non-`_test` database, but this is the
  // call that actually destroys rows, so it re-checks against the live connection.
  const [current] = (await db.execute(sql`SELECT current_database() AS name`)) as unknown as Array<{
    name: string;
  }>;
  if (!current?.name.endsWith('_test')) {
    throw new Error(`refusing to truncate "${current?.name}" — not a _test database`);
  }
  const tables = await appTables();
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

export async function seedUser(
  over: Partial<{ email: string; name: string; password: string }> = {},
): Promise<SeededUser> {
  const email = over.email ?? `u-${randomUUID()}@example.test`;
  const password = over.password ?? 'correct-horse-battery';
  const [row] = await db
    .insert(schema.users)
    .values({
      email,
      name: over.name ?? 'Test User',
      passwordHash: await hashPassword(password),
    })
    .returning({ id: schema.users.id });
  return { id: row!.id, email, password };
}

export async function seedWorkspace(
  ownerId: string,
  over: Partial<{
    isPersonal: number;
    name: string;
    planKind: string;
    splitMode: string;
    monthlyPriceUsd: string;
    billingCycleDay: number;
  }> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.workspaces)
    .values({
      slug: `ws-${randomUUID().slice(0, 12)}`,
      name: over.name ?? 'Test Workspace',
      ownerId,
      isPersonal: over.isPersonal ?? 0,
      planKind: over.planKind ?? 'max_20x',
      planName: 'Claude Max 20x',
      splitMode: over.splitMode ?? 'usage',
      monthlyPriceUsd: over.monthlyPriceUsd ?? '200.00',
      billingCycleDay: over.billingCycleDay ?? 1,
    })
    .returning({ id: schema.workspaces.id });
  return row!.id;
}

export async function seedMember(
  workspaceId: string,
  userId: string,
  over: Partial<{ role: 'owner' | 'member'; trackingFrom: string; leftAt: Date | null }> = {},
): Promise<void> {
  await db.insert(schema.workspaceMembers).values({
    workspaceId,
    userId,
    role: over.role ?? 'member',
    trackingFrom: over.trackingFrom ?? '2020-01-01',
    leftAt: over.leftAt ?? null,
  });
}

export async function seedProject(workspaceId: string, ownerUserId: string): Promise<string> {
  const [row] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      ownerUserId,
      pathHash: randomUUID().replace(/-/g, '').slice(0, 16),
      name: 'proj',
    })
    .returning({ id: schema.projects.id });
  return row!.id;
}

export async function seedApiKey(userId: string): Promise<{ id: string; token: string }> {
  const key = generateApiKey();
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      userId,
      prefix: key.prefix,
      secretHash: await hashPassword(key.full),
      name: 'test key',
    })
    .returning({ id: schema.apiKeys.id });
  return { id: row!.id, token: key.full };
}

export async function seedWebSession(
  userId: string,
  expiresAt = new Date('2099-01-01'),
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.sessionsWeb).values({ id, userId, expiresAt });
  return id;
}

let modelCounter = 0;

// Unique per call so the module-global price memo in services/pricing.ts (60s TTL,
// never reset between tests) can never serve one test's row to another.
export function uniqueModel(label = 'model'): string {
  modelCounter += 1;
  return `oa-test-${label}-x${modelCounter}`;
}

export async function seedPrice(
  model: string,
  over: Partial<{
    agentKind: string;
    inputPerMtok: string;
    outputPerMtok: string;
    cacheReadPerMtok: string;
    cacheWrite5mPerMtok: string;
    cacheWrite1hPerMtok: string;
  }> = {},
): Promise<void> {
  await db.insert(schema.modelPrices).values({
    agentKind: over.agentKind ?? 'claude-code',
    model,
    effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    effectiveTo: null,
    inputPerMtok: over.inputPerMtok ?? '3',
    outputPerMtok: over.outputPerMtok ?? '15',
    cacheReadPerMtok: over.cacheReadPerMtok ?? '0.3',
    cacheWrite5mPerMtok: over.cacheWrite5mPerMtok ?? '3.75',
    cacheWrite1hPerMtok: over.cacheWrite1hPerMtok ?? '6',
  });
}

export function pathHash(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

// A schema-valid Session payload with everything at zero, so each test can override
// only the fields it actually asserts on.
export function makeSessionPayload(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    agent_kind: 'claude-code',
    session_id: randomUUID(),
    path_hash: pathHash(),
    project_name: 'proj',
    started_at: '2026-03-05T10:00:00.000Z',
    ended_at: '2026-03-05T10:05:00.000Z',
    model: 'claude-opus-4-7',
    cli_version: '1.2.3',
    tokens: {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      reasoning: 0,
      extra_total: 0,
    },
    lines_added: 0,
    lines_removed: 0,
    lines_by_extension: {},
    tools: {},
    prompts: [],
    requests: [],
    subagents: {},
    ...over,
  };
}

export function makeRequest(over: Partial<SessionPayload['requests'][number]> = {}) {
  return {
    prompt_idx: 0,
    ts: '2026-03-05T10:01:00.000Z',
    model: 'claude-opus-4-7',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    reasoning_tokens: 0,
    extra_total_tokens: 0,
    lines_added: 0,
    lines_removed: 0,
    ...over,
  };
}

export function makePrompt(over: Partial<SessionPayload['prompts'][number]> = {}) {
  return {
    idx: 0,
    ts: '2026-03-05T10:00:30.000Z',
    length: 42,
    request_count: 1,
    command: null,
    skills: [],
    ...over,
  };
}

export async function countRows(table: string, sessionId: string): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(table)} WHERE session_id = ${sessionId}`,
  )) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}
