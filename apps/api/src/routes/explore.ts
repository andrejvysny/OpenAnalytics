import { Hono } from 'hono';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { resolveReadWorkspace, WorkspaceAccessError } from '../services/workspace';

export const exploreRoute = new Hono<{ Variables: SessionVars }>();
exploreRoute.use('*', sessionAuth);

exploreRoute.get('/', async (c) => {
  const userId = c.get('userId');
  let wsId: string;
  try {
    wsId = await resolveReadWorkspace(db, userId, c.req.query('workspace_id'));
  } catch (e) {
    if (e instanceof WorkspaceAccessError) return c.json({ ok: false, error: e.message }, e.status);
    throw e;
  }

  const fromStr = c.req.query('from');
  const toStr = c.req.query('to');
  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 7 * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return c.json({ ok: false, error: 'invalid from/to (expected ISO datetime)' }, 400);
  }

  const where = and(
    eq(schema.sessions.workspaceId, wsId),
    eq(schema.sessions.userId, userId),
    gte(schema.sessions.startedAt, from),
    lt(schema.sessions.startedAt, to),
  );

  const [summary] = await db
    .select({
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      sessions: sql<number>`COUNT(*)`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
      input: sql<number>`COALESCE(SUM(${schema.sessions.inputTokens}),0)`,
      output: sql<number>`COALESCE(SUM(${schema.sessions.outputTokens}),0)`,
      cacheRead: sql<number>`COALESCE(SUM(${schema.sessions.cacheReadTokens}),0)`,
      cacheCreation: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreationTokens}),0)`,
      reasoning: sql<number>`COALESCE(SUM(${schema.sessions.reasoningTokens}),0)`,
      extraTotal: sql<number>`COALESCE(SUM(${schema.sessions.extraTotalTokens}),0)`,
      added: sql<number>`COALESCE(SUM(${schema.sessions.linesAdded}),0)`,
      removed: sql<number>`COALESCE(SUM(${schema.sessions.linesRemoved}),0)`,
      activeDays: sql<number>`COUNT(DISTINCT DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC'))`,
    })
    .from(schema.sessions)
    .where(where);

  const daily = await db
    .select({
      date: sql<string>`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`,
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
      input: sql<number>`COALESCE(SUM(${schema.sessions.inputTokens}),0)`,
      output: sql<number>`COALESCE(SUM(${schema.sessions.outputTokens}),0)`,
    })
    .from(schema.sessions)
    .where(where)
    .groupBy(sql`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`);

  const projects = await db
    .select({
      name: schema.projects.name,
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      sessions: sql<number>`COUNT(*)`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
    })
    .from(schema.sessions)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.sessions.projectId))
    .where(where)
    .groupBy(schema.projects.name)
    .orderBy(desc(sql`COALESCE(SUM(${schema.sessions.costUsd}),0)`))
    .limit(50);

  const tools = await db
    .select({
      tool: schema.toolUsage.tool,
      count: sql<number>`COALESCE(SUM(${schema.toolUsage.count}),0)`,
    })
    .from(schema.toolUsage)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.toolUsage.sessionId))
    .where(where)
    .groupBy(schema.toolUsage.tool)
    .orderBy(desc(sql`COALESCE(SUM(${schema.toolUsage.count}),0)`));

  const langs = await db
    .select({
      ext: schema.languageDiffs.ext,
      added: sql<number>`COALESCE(SUM(${schema.languageDiffs.added}),0)`,
      removed: sql<number>`COALESCE(SUM(${schema.languageDiffs.removed}),0)`,
    })
    .from(schema.languageDiffs)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.languageDiffs.sessionId))
    .where(where)
    .groupBy(schema.languageDiffs.ext)
    .orderBy(desc(sql`COALESCE(SUM(${schema.languageDiffs.added}),0)`));

  return c.json({
    ok: true,
    from: from.toISOString(),
    to: to.toISOString(),
    summary,
    daily: daily.map((r) => ({ ...r, cost: Number(r.cost) })),
    projects: projects.map((r) => ({ ...r, cost: Number(r.cost) })),
    tools,
    languages: langs,
  });
});
