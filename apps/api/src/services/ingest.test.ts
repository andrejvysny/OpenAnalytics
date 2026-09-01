import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { schema } from '@oa/db';
import {
  countRows,
  db,
  makePrompt,
  makeRequest,
  makeSessionPayload,
  seedMember,
  seedPrice,
  seedUser,
  seedWorkspace,
  truncateAll,
  uniqueModel,
} from '../test/helpers';
import { ingestSessions } from './ingest';

interface Ctx {
  userId: string;
  workspaceId: string;
}

async function ctx(): Promise<Ctx> {
  const user = await seedUser();
  const workspaceId = await seedWorkspace(user.id);
  await seedMember(workspaceId, user.id, { role: 'owner' });
  return { userId: user.id, workspaceId };
}

async function sessionRow(id: string) {
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).limit(1);
  return row;
}

describe('ingestSessions', () => {
  beforeEach(truncateAll);

  test('accepts a fresh session and upserts its project', async () => {
    const { userId, workspaceId } = await ctx();
    const payload = makeSessionPayload({
      model: uniqueModel('unpriced'),
      tokens: {
        input: 100,
        output: 200,
        cache_read: 0,
        cache_creation: 0,
        cache_creation_5m: 0,
        cache_creation_1h: 0,
        reasoning: 0,
        extra_total: 0,
      },
      lines_added: 12,
      lines_removed: 3,
    });

    const result = await ingestSessions(db, userId, workspaceId, [payload]);
    expect(result).toEqual({ accepted: 1, ignored: 0, failed: [] });

    const row = await sessionRow(payload.session_id);
    expect(row?.userId).toBe(userId);
    expect(row?.workspaceId).toBe(workspaceId);
    expect(row?.durationS).toBe(300);
    expect(row?.linesAdded).toBe(12);

    const projects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.pathHash, payload.path_hash));
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('proj');
  });

  test('costs to 0 (and flags model_priced=false) when no price row exists', async () => {
    const { userId, workspaceId } = await ctx();
    const payload = makeSessionPayload({
      model: uniqueModel('nopricerow'),
      tokens: {
        input: 1_000_000,
        output: 1_000_000,
        cache_read: 0,
        cache_creation: 0,
        cache_creation_5m: 0,
        cache_creation_1h: 0,
        reasoning: 0,
        extra_total: 0,
      },
    });

    await ingestSessions(db, userId, workspaceId, [payload]);
    const row = await sessionRow(payload.session_id);
    expect(row?.costUsd).toBe('0.000000');
    expect((row?.costBreakdown as { model_priced: boolean }).model_priced).toBe(false);
  });

  test('computes cost from model_prices at ingest, for the session and each request', async () => {
    const { userId, workspaceId } = await ctx();
    const model = uniqueModel('priced');
    await seedPrice(model); // 3 / 15 / 0.3 / 3.75 per Mtok

    const payload = makeSessionPayload({
      model,
      tokens: {
        input: 1_000_000, // 3.00
        output: 100_000, //  1.50
        cache_read: 0,
        cache_creation: 0,
        cache_creation_5m: 0,
        cache_creation_1h: 0,
        reasoning: 0,
        extra_total: 0,
      },
      requests: [makeRequest({ model, input_tokens: 500_000 })], // 1.50
    });

    await ingestSessions(db, userId, workspaceId, [payload]);

    const row = await sessionRow(payload.session_id);
    expect(row?.costUsd).toBe('4.500000');
    const breakdown = row?.costBreakdown as { model_priced: boolean; model_resolved: string };
    expect(breakdown.model_priced).toBe(true);
    expect(breakdown.model_resolved).toBe(model);

    const requests = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.sessionId, payload.session_id));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.costUsd).toBe('1.500000');
  });

  test('buckets request timestamps down to the hour', async () => {
    const { userId, workspaceId } = await ctx();
    const payload = makeSessionPayload({
      model: uniqueModel('bucket'),
      requests: [makeRequest({ ts: '2026-03-05T10:47:31.123Z' })],
    });

    await ingestSessions(db, userId, workspaceId, [payload]);
    const [req] = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.sessionId, payload.session_id));
    expect(req?.tsBucket.toISOString()).toBe('2026-03-05T10:00:00.000Z');
    expect(req?.ts.toISOString()).toBe('2026-03-05T10:00:00.000Z');
  });

  test('re-ingesting the same session_id replaces child rows instead of duplicating them', async () => {
    const { userId, workspaceId } = await ctx();
    const model = uniqueModel('reingest');
    const first = makeSessionPayload({
      model,
      prompts: [makePrompt({ idx: 0 }), makePrompt({ idx: 1 })],
      requests: [makeRequest(), makeRequest(), makeRequest()],
      tools: { Read: 4, Edit: 2 },
      lines_by_extension: { ts: { added: 10, removed: 1 }, md: { added: 3, removed: 0 } },
    });

    await ingestSessions(db, userId, workspaceId, [first]);
    await ingestSessions(db, userId, workspaceId, [first]);

    const id = first.session_id;
    expect(await countRows('prompts', id)).toBe(2);
    expect(await countRows('requests', id)).toBe(3);
    expect(await countRows('tool_usage', id)).toBe(2);
    expect(await countRows('language_diffs', id)).toBe(2);

    // A shrinking re-sync must shrink the stored rows too, not merge with the old set.
    const second = makeSessionPayload({
      ...first,
      prompts: [makePrompt({ idx: 0 })],
      requests: [makeRequest()],
      tools: { Read: 1 },
      lines_by_extension: { ts: { added: 1, removed: 0 } },
      lines_added: 1,
    });
    const result = await ingestSessions(db, userId, workspaceId, [second]);
    expect(result.accepted).toBe(1);

    expect(await countRows('prompts', id)).toBe(1);
    expect(await countRows('requests', id)).toBe(1);
    expect(await countRows('tool_usage', id)).toBe(1);
    expect(await countRows('language_diffs', id)).toBe(1);

    const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.linesAdded).toBe(1);
    expect(sessions[0]?.promptCount).toBe(1);
  });

  test('a second user cannot take over an existing session_id', async () => {
    const owner = await ctx();
    const attacker = await ctx();

    const payload = makeSessionPayload({ model: uniqueModel('owned'), lines_added: 7 });
    await ingestSessions(db, owner.userId, owner.workspaceId, [payload]);

    const stolen = makeSessionPayload({ ...payload, lines_added: 999 });
    const result = await ingestSessions(db, attacker.userId, attacker.workspaceId, [stolen]);
    expect(result.accepted).toBe(0);
    expect(result.ignored).toBe(1);
    expect(result.failed).toEqual([payload.session_id]);

    // The whole attempt rolls back: neither the session row nor the project upsert lands.
    const row = await sessionRow(payload.session_id);
    expect(row?.userId).toBe(owner.userId);
    expect(row?.workspaceId).toBe(owner.workspaceId);
    expect(row?.linesAdded).toBe(7);

    const attackerProjects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.ownerUserId, attacker.userId));
    expect(attackerProjects).toHaveLength(0);
  });

  test('one failing session does not abort its valid siblings', async () => {
    const owner = await ctx();
    const attacker = await ctx();

    const contested = makeSessionPayload({ model: uniqueModel('contested') });
    await ingestSessions(db, owner.userId, owner.workspaceId, [contested]);

    const mine = makeSessionPayload({ model: uniqueModel('mine') });
    const result = await ingestSessions(db, attacker.userId, attacker.workspaceId, [
      contested,
      mine,
    ]);
    expect(result.accepted).toBe(1);
    expect(result.failed).toEqual([contested.session_id]);
    expect(await sessionRow(mine.session_id)).toBeDefined();
  });
});
