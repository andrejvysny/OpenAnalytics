import { Hono } from 'hono';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';

export const planRoute = new Hono<{ Variables: SessionVars }>();

planRoute.use('*', sessionAuth);

// Compute current billing period: [day, +1 month) starting at workspaces.billingCycleDay.
function currentPeriod(billingCycleDay: number): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const startMonth = d >= billingCycleDay ? m : m - 1;
  const from = new Date(Date.UTC(y, startMonth, billingCycleDay));
  const to = new Date(Date.UTC(y, startMonth + 1, billingCycleDay));
  return { from, to };
}

planRoute.get('/:workspaceId/split', async (c) => {
  const userId = c.get('userId');
  const wsId = c.req.param('workspaceId');

  const memberCheck = await db
    .select({ ws: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, wsId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (memberCheck.length === 0) return c.json({ ok: false, error: 'forbidden' }, 403);

  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, wsId))
    .limit(1);
  if (!ws) return c.json({ ok: false, error: 'not found' }, 404);

  const { from, to } = currentPeriod(ws.billingCycleDay);

  // Per-member breakdown.
  const members = await db
    .select({
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      sessions: sql<number>`COUNT(${schema.sessions.id})`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
      input: sql<number>`COALESCE(SUM(${schema.sessions.inputTokens}),0)`,
      output: sql<number>`COALESCE(SUM(${schema.sessions.outputTokens}),0)`,
      cacheRead: sql<number>`COALESCE(SUM(${schema.sessions.cacheReadTokens}),0)`,
      linesAdded: sql<number>`COALESCE(SUM(${schema.sessions.linesAdded}),0)`,
      linesRemoved: sql<number>`COALESCE(SUM(${schema.sessions.linesRemoved}),0)`,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .leftJoin(
      schema.sessions,
      and(
        eq(schema.sessions.userId, schema.workspaceMembers.userId),
        eq(schema.sessions.workspaceId, wsId),
        gte(schema.sessions.startedAt, from),
        lt(schema.sessions.startedAt, to),
      ),
    )
    .where(eq(schema.workspaceMembers.workspaceId, wsId))
    .groupBy(
      schema.workspaceMembers.userId,
      schema.workspaceMembers.role,
      schema.users.name,
      schema.users.email,
      schema.users.avatarUrl,
    );

  const total = members.reduce((s, m) => s + Number(m.cost), 0);
  const enriched = members
    .map((m) => ({
      ...m,
      cost: Number(m.cost),
      percent: total > 0 ? Number(((Number(m.cost) / total) * 100).toFixed(2)) : 0,
      isYou: m.userId === userId,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Daily cost per member across the period.
  const dailyRows = await db
    .select({
      userId: schema.sessions.userId,
      date: sql<string>`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`,
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.workspaceId, wsId),
        gte(schema.sessions.startedAt, from),
        lt(schema.sessions.startedAt, to),
      ),
    )
    .groupBy(schema.sessions.userId, sql`DATE(${schema.sessions.startedAt} AT TIME ZONE 'UTC')`);

  return c.json({
    ok: true,
    workspace: {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      planTier: ws.planTier,
      monthlyBudgetUsd: ws.monthlyBudgetUsd,
      billingCycleDay: ws.billingCycleDay,
      currency: ws.currency,
    },
    period: { from: from.toISOString(), to: to.toISOString() },
    total_cost: total,
    members: enriched,
    daily: dailyRows.map((r) => ({ userId: r.userId, date: r.date, cost: Number(r.cost) })),
  });
});
