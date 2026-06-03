import { Hono } from 'hono';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { resolveReadWorkspace, WorkspaceAccessError } from '../services/workspace';

export const heatmapRoute = new Hono<{ Variables: SessionVars }>();

heatmapRoute.use('*', sessionAuth);

heatmapRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const year = Number(c.req.query('year')) || new Date().getUTCFullYear();
  let wsId: string;
  try {
    wsId = await resolveReadWorkspace(db, userId, c.req.query('workspace_id'));
  } catch (e) {
    if (e instanceof WorkspaceAccessError) return c.json({ ok: false, error: e.message }, e.status);
    throw e;
  }

  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const rows = await db
    .select({
      date: sql<string>`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.workspaceId, wsId),
        eq(schema.sessions.userId, userId),
        gte(schema.sessions.startedAt, from),
        lt(schema.sessions.startedAt, to),
      ),
    )
    .groupBy(sql`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`);

  return c.json({
    ok: true,
    year,
    days: rows.map((r) => ({ date: r.date, prompts: r.prompts, cost: Number(r.cost) })),
  });
});
