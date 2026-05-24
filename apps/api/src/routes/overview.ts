import { Hono } from 'hono';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { getOrCreatePersonalWorkspace } from '../services/workspace';

export const overviewRoute = new Hono<{ Variables: SessionVars }>();

overviewRoute.use('*', sessionAuth);

overviewRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const wsParam = c.req.query('workspace_id');
  const wsId = wsParam ?? (await getOrCreatePersonalWorkspace(db, userId));

  const today = new Date().toISOString().slice(0, 10);

  const [todayStats] = await db
    .select({
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      sessions: sql<number>`COUNT(*)`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
      input: sql<number>`COALESCE(SUM(${schema.sessions.inputTokens}),0)`,
      output: sql<number>`COALESCE(SUM(${schema.sessions.outputTokens}),0)`,
      cache_read: sql<number>`COALESCE(SUM(${schema.sessions.cacheReadTokens}),0)`,
      cache_creation: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreationTokens}),0)`,
      cache_creation_5m: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreation5mTokens}),0)`,
      cache_creation_1h: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreation1hTokens}),0)`,
      added: sql<number>`COALESCE(SUM(${schema.sessions.linesAdded}),0)`,
      removed: sql<number>`COALESCE(SUM(${schema.sessions.linesRemoved}),0)`,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.workspaceId, wsId),
        eq(schema.sessions.userId, userId),
        gte(sql`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`, today),
      ),
    );

  const [allTime] = await db
    .select({
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      sessions: sql<number>`COUNT(*)`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
      input: sql<number>`COALESCE(SUM(${schema.sessions.inputTokens}),0)`,
      output: sql<number>`COALESCE(SUM(${schema.sessions.outputTokens}),0)`,
      cache_read: sql<number>`COALESCE(SUM(${schema.sessions.cacheReadTokens}),0)`,
      cache_creation: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreationTokens}),0)`,
      cache_creation_5m: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreation5mTokens}),0)`,
      cache_creation_1h: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreation1hTokens}),0)`,
      added: sql<number>`COALESCE(SUM(${schema.sessions.linesAdded}),0)`,
      removed: sql<number>`COALESCE(SUM(${schema.sessions.linesRemoved}),0)`,
      activeDays: sql<number>`COUNT(DISTINCT DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC'))`,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.workspaceId, wsId), eq(schema.sessions.userId, userId)));

  const topProjects = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      sessions: sql<number>`COUNT(${schema.sessions.id})`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
    })
    .from(schema.projects)
    .leftJoin(schema.sessions, eq(schema.sessions.projectId, schema.projects.id))
    .where(eq(schema.projects.workspaceId, wsId))
    .groupBy(schema.projects.id, schema.projects.name)
    .orderBy(desc(sql`COALESCE(SUM(${schema.sessions.costUsd}),0)`))
    .limit(20);

  return c.json({
    ok: true,
    workspace_id: wsId,
    today: todayStats,
    all_time: allTime,
    top_projects: topProjects,
  });
});
