import { Hono } from 'hono';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { getOrCreatePersonalWorkspace } from '../services/workspace';
import { planNameFor, type PlanKind } from '../services/plans';

export const planRoute = new Hono<{ Variables: SessionVars }>();

planRoute.use('*', sessionAuth);

// Lightweight personal-workspace utilization summary used by the Overview "Plan hero" panel.
planRoute.get('/me', async (c) => {
  const userId = c.get('userId');
  const wsId = await getOrCreatePersonalWorkspace(db, userId);
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, wsId))
    .limit(1);
  if (!ws) return c.json({ ok: false, error: 'not found' }, 404);

  const { from, to } = currentPeriod(ws.billingCycleDay);
  const monthlyPriceUsd = ws.monthlyPriceUsd === null ? 0 : Number(ws.monthlyPriceUsd);

  const [periodAgg] = await db
    .select({
      cost: sql<string>`COALESCE(SUM(${schema.sessions.costUsd}),0)`,
      sessions: sql<number>`COUNT(*)`,
      prompts: sql<number>`COALESCE(SUM(${schema.sessions.promptCount}),0)`,
      input: sql<number>`COALESCE(SUM(${schema.sessions.inputTokens}),0)`,
      output: sql<number>`COALESCE(SUM(${schema.sessions.outputTokens}),0)`,
      cacheRead: sql<number>`COALESCE(SUM(${schema.sessions.cacheReadTokens}),0)`,
      cacheCreation: sql<number>`COALESCE(SUM(${schema.sessions.cacheCreationTokens}),0)`,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.workspaceId, wsId),
        eq(schema.sessions.userId, userId),
        gte(schema.sessions.startedAt, from),
        lt(schema.sessions.startedAt, to),
      ),
    );

  const actualUsageCostUsd = Number(periodAgg?.cost ?? 0);
  const daysRemaining = Math.max(0, Math.ceil((to.getTime() - Date.now()) / 86400000));
  const costUtilizationPercent =
    monthlyPriceUsd > 0 ? Math.min(100, (actualUsageCostUsd / monthlyPriceUsd) * 100) : 0;

  return c.json({
    ok: true,
    workspace: { id: ws.id, name: ws.name, isPersonal: ws.isPersonal === 1 },
    subscription: {
      planKind: (ws.planKind ?? 'api') as PlanKind,
      planName: ws.planName ?? planNameFor((ws.planKind ?? 'api') as PlanKind),
      monthlyPriceUsd,
      billingCycleDay: ws.billingCycleDay,
      currency: ws.currency ?? 'USD',
    },
    period: { from: from.toISOString(), to: to.toISOString(), daysRemaining },
    totals: {
      actualUsageCostUsd,
      costUtilizationPercent,
      sessions: Number(periodAgg?.sessions ?? 0),
      prompts: Number(periodAgg?.prompts ?? 0),
      input: Number(periodAgg?.input ?? 0),
      output: Number(periodAgg?.output ?? 0),
      cacheRead: Number(periodAgg?.cacheRead ?? 0),
      cacheCreation: Number(periodAgg?.cacheCreation ?? 0),
    },
  });
});

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

function round2(v: number): number {
  return Number(v.toFixed(2));
}

function percent(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

function effectiveExpectedShares<T extends { expectedShareBps: number | null }>(
  members: T[],
  splitMode: string,
): number[] {
  if (members.length === 0) return [];
  if (splitMode === 'custom_weights') {
    const total = members.reduce((s, m) => s + (m.expectedShareBps ?? 0), 0);
    if (total > 0) return members.map((m) => ((m.expectedShareBps ?? 0) / total) * 100);
  }
  const equal = 100 / members.length;
  return members.map(() => equal);
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
  const monthlyPriceUsd = ws.monthlyPriceUsd === null ? 0 : Number(ws.monthlyPriceUsd);

  const memberRows = await db
    .select({
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      expectedShareBps: schema.workspaceMembers.expectedShareBps,
      trackingFrom: schema.workspaceMembers.trackingFrom,
      joinedAt: schema.workspaceMembers.joinedAt,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, wsId));

  const usageRows = await db
    .select({
      userId: schema.workspaceMembers.userId,
      actualUsageCostUsd: sql<string>`COALESCE(SUM(CASE WHEN ${schema.requests.costUsd} > 0 THEN ${schema.requests.costUsd} ELSE ${schema.sessions.costUsd} * (${schema.requests.inputTokens} + ${schema.requests.outputTokens} + ${schema.requests.cacheReadTokens} + ${schema.requests.cacheCreationTokens}) / NULLIF(${schema.sessions.inputTokens} + ${schema.sessions.outputTokens} + ${schema.sessions.cacheReadTokens} + ${schema.sessions.cacheCreationTokens}, 0) END),0)`,
      sessions: sql<number>`COUNT(DISTINCT ${schema.requests.sessionId})`,
      prompts: sql<number>`COUNT(DISTINCT (${schema.sessions.id}::text || ':' || ${schema.requests.promptIdx}::text))`,
      input: sql<number>`COALESCE(SUM(${schema.requests.inputTokens}),0)`,
      output: sql<number>`COALESCE(SUM(${schema.requests.outputTokens}),0)`,
      cacheRead: sql<number>`COALESCE(SUM(${schema.requests.cacheReadTokens}),0)`,
      cacheCreation: sql<number>`COALESCE(SUM(${schema.requests.cacheCreationTokens}),0)`,
      linesAdded: sql<number>`COALESCE(SUM(${schema.requests.linesAdded}),0)`,
      linesRemoved: sql<number>`COALESCE(SUM(${schema.requests.linesRemoved}),0)`,
    })
    .from(schema.workspaceMembers)
    .leftJoin(
      schema.sessions,
      and(
        eq(schema.sessions.userId, schema.workspaceMembers.userId),
        eq(schema.sessions.workspaceId, wsId),
      ),
    )
    .leftJoin(
      schema.requests,
      and(
        eq(schema.requests.sessionId, schema.sessions.id),
        gte(schema.requests.ts, from),
        lt(schema.requests.ts, to),
        gte(
          schema.requests.ts,
          sql`GREATEST(${from}, (${schema.workspaceMembers.trackingFrom})::timestamptz)`,
        ),
      ),
    )
    .where(eq(schema.workspaceMembers.workspaceId, wsId))
    .groupBy(schema.workspaceMembers.userId);

  const usageByUser = new Map(usageRows.map((r) => [r.userId, r]));
  const totalUsageCost = usageRows.reduce((s, r) => s + Number(r.actualUsageCostUsd), 0);
  const totalTokens = usageRows.reduce(
    (s, r) =>
      s + Number(r.input) + Number(r.output) + Number(r.cacheRead) + Number(r.cacheCreation),
    0,
  );
  const expectedShares = effectiveExpectedShares(memberRows, ws.splitMode);

  const members = memberRows
    .map((m, idx) => {
      const u = usageByUser.get(m.userId);
      const cost = u ? Number(u.actualUsageCostUsd) : 0;
      const rawTokens = u
        ? Number(u.input) + Number(u.output) + Number(u.cacheRead) + Number(u.cacheCreation)
        : 0;
      const usagePercent = percent(cost, totalUsageCost);
      const tokenPercent = percent(rawTokens, totalTokens);
      const expectedSharePercent = Number((expectedShares[idx] ?? 0).toFixed(2));
      const owedPercent =
        ws.splitMode === 'usage'
          ? usagePercent
          : ws.splitMode === 'equal'
            ? expectedSharePercent
            : expectedSharePercent;
      return {
        userId: m.userId,
        role: m.role,
        name: m.name,
        email: m.email,
        avatarUrl: m.avatarUrl,
        trackingFrom: m.trackingFrom,
        joinedAt: m.joinedAt,
        expectedShareBps: m.expectedShareBps,
        expectedSharePercent,
        usagePercent,
        tokenPercent,
        fairShareDeltaPercent: Number((usagePercent - expectedSharePercent).toFixed(2)),
        actualUsageCostUsd: round2(cost),
        subscriptionShareUsd: round2((monthlyPriceUsd * owedPercent) / 100),
        rawTokens,
        input: u?.input ?? 0,
        output: u?.output ?? 0,
        cacheRead: u?.cacheRead ?? 0,
        cacheCreation: u?.cacheCreation ?? 0,
        sessions: u?.sessions ?? 0,
        prompts: u?.prompts ?? 0,
        linesAdded: u?.linesAdded ?? 0,
        linesRemoved: u?.linesRemoved ?? 0,
        isYou: m.userId === userId,
      };
    })
    .sort((a, b) => b.actualUsageCostUsd - a.actualUsageCostUsd);

  const dailyRows = await db
    .select({
      userId: schema.sessions.userId,
      date: sql<string>`DATE(${schema.requests.ts} AT TIME ZONE 'UTC')`,
      actualUsageCostUsd: sql<string>`COALESCE(SUM(CASE WHEN ${schema.requests.costUsd} > 0 THEN ${schema.requests.costUsd} ELSE ${schema.sessions.costUsd} * (${schema.requests.inputTokens} + ${schema.requests.outputTokens} + ${schema.requests.cacheReadTokens} + ${schema.requests.cacheCreationTokens}) / NULLIF(${schema.sessions.inputTokens} + ${schema.sessions.outputTokens} + ${schema.sessions.cacheReadTokens} + ${schema.sessions.cacheCreationTokens}, 0) END),0)`,
      tokens: sql<number>`COALESCE(SUM(${schema.requests.inputTokens} + ${schema.requests.outputTokens} + ${schema.requests.cacheReadTokens} + ${schema.requests.cacheCreationTokens}),0)`,
    })
    .from(schema.requests)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.requests.sessionId))
    .innerJoin(
      schema.workspaceMembers,
      and(
        eq(schema.workspaceMembers.workspaceId, schema.sessions.workspaceId),
        eq(schema.workspaceMembers.userId, schema.sessions.userId),
      ),
    )
    .where(
      and(
        eq(schema.sessions.workspaceId, wsId),
        gte(schema.requests.ts, from),
        lt(schema.requests.ts, to),
        gte(
          schema.requests.ts,
          sql`GREATEST(${from}, (${schema.workspaceMembers.trackingFrom})::timestamptz)`,
        ),
      ),
    )
    .groupBy(schema.sessions.userId, sql`DATE(${schema.requests.ts} AT TIME ZONE 'UTC')`);

  const daysRemaining = Math.max(0, Math.ceil((to.getTime() - Date.now()) / 86400000));
  return c.json({
    ok: true,
    workspace: {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      isPersonal: ws.isPersonal,
    },
    subscription: {
      planKind: ws.planKind,
      planName: ws.planName ?? ws.planTier ?? 'Custom',
      monthlyPriceUsd,
      splitMode: ws.splitMode,
      billingCycleDay: ws.billingCycleDay,
      currency: ws.currency,
    },
    period: { from: from.toISOString(), to: to.toISOString(), daysRemaining },
    totals: {
      actualUsageCostUsd: round2(totalUsageCost),
      subscriptionPriceUsd: monthlyPriceUsd,
      costUtilizationPercent: percent(totalUsageCost, monthlyPriceUsd),
      rawTokens: totalTokens,
    },
    members,
    dailyCost: dailyRows.map((r) => ({
      userId: r.userId,
      date: r.date,
      actualUsageCostUsd: round2(Number(r.actualUsageCostUsd)),
    })),
    dailyTokens: dailyRows.map((r) => ({
      userId: r.userId,
      date: r.date,
      tokens: Number(r.tokens),
    })),
  });
});
