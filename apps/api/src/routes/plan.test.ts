import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setSystemTime } from 'bun:test';
import { Hono } from 'hono';
import { schema } from '@oa/db';
import {
  db,
  seedMember,
  seedProject,
  seedUser,
  seedWebSession,
  seedWorkspace,
  truncateAll,
} from '../test/helpers';
import { planRoute } from './plan';

// index.ts starts a Bun.serve() listener at import time — mount the router directly.
const app = new Hono().route('/api/plan', planRoute);

// Everything below is anchored inside this period so the assertions never depend on
// the wall clock. billingCycleDay 1 => [2026-03-01, 2026-04-01).
const NOW = '2026-03-15T12:00:00.000Z';
const PERIOD_FROM = '2026-03-01T00:00:00.000Z';
const PERIOD_TO = '2026-04-01T00:00:00.000Z';

interface MemberSplit {
  userId: string;
  leftAt: string | null;
  actualUsageCostUsd: number;
  subscriptionShareUsd: number;
  usagePercent: number;
  // Postgres returns COUNT()/SUM() over bigint columns as a string and the route
  // passes those through unconverted (unlike the cost fields, which it Number()s).
  // Pinned here so a future numeric normalization is a deliberate, visible change.
  sessions: string | number;
  isYou: boolean;
}
interface SplitBody {
  ok: boolean;
  members: MemberSplit[];
  totals: { actualUsageCostUsd: number };
  period: { from: string; to: string; daysRemaining: number };
  dailyCost: Array<{ userId: string; date: string; actualUsageCostUsd: number }>;
}

async function seedAgentSession(opts: {
  workspaceId: string;
  userId: string;
  projectId: string;
  startedAt: string;
  costUsd: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const startedAt = new Date(opts.startedAt);
  await db.insert(schema.sessions).values({
    id,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    projectId: opts.projectId,
    agentKind: 'claude-code',
    startedAt,
    endedAt: startedAt,
    durationS: 60,
    model: 'claude-opus-4-7',
    costUsd: opts.costUsd,
  });
  return id;
}

async function seedAgentRequest(sessionId: string, tsBucket: string, costUsd: string) {
  const ts = new Date(tsBucket);
  await db.insert(schema.requests).values({
    sessionId,
    promptIdx: 0,
    ts,
    tsBucket: ts,
    model: 'claude-opus-4-7',
    inputTokens: 1000,
    costUsd,
  });
}

async function getSplit(workspaceId: string, cookie: string | null): Promise<Response> {
  return app.request(`/api/plan/${workspaceId}/split`, {
    headers: cookie ? { cookie: `oa_session=${cookie}` } : {},
  });
}

describe('GET /api/plan/:workspaceId/split', () => {
  let workspaceId: string;
  let stayer: string;
  let leaver: string;
  let earlyLeaver: string;
  let cookie: string;

  beforeAll(async () => {
    await truncateAll();
    setSystemTime(new Date(NOW));

    const a = await seedUser({ name: 'Stayer' });
    const b = await seedUser({ name: 'Leaver' });
    const c = await seedUser({ name: 'Early Leaver' });
    stayer = a.id;
    leaver = b.id;
    earlyLeaver = c.id;

    workspaceId = await seedWorkspace(stayer, {
      isPersonal: 0,
      splitMode: 'usage',
      monthlyPriceUsd: '200.00',
      billingCycleDay: 1,
    });
    await seedMember(workspaceId, stayer, { role: 'owner', trackingFrom: '2026-01-01' });
    await seedMember(workspaceId, leaver, {
      trackingFrom: '2026-01-01',
      leftAt: new Date('2026-03-10T00:00:00Z'),
    });
    await seedMember(workspaceId, earlyLeaver, {
      trackingFrom: '2026-01-01',
      leftAt: new Date('2026-02-01T00:00:00Z'),
    });

    const project = await seedProject(workspaceId, stayer);

    // Stayer: one in-period request, one from the previous period.
    const inPeriod = await seedAgentSession({
      workspaceId,
      userId: stayer,
      projectId: project,
      startedAt: '2026-03-05T00:00:00Z',
      costUsd: '10.000000',
    });
    await seedAgentRequest(inPeriod, '2026-03-05T00:00:00Z', '10.000000');
    const prevPeriod = await seedAgentSession({
      workspaceId,
      userId: stayer,
      projectId: project,
      startedAt: '2026-02-20T00:00:00Z',
      costUsd: '50.000000',
    });
    await seedAgentRequest(prevPeriod, '2026-02-20T00:00:00Z', '50.000000');

    // Leaver: one request before left_at, one after (must not be attributed).
    const leaverSession = await seedAgentSession({
      workspaceId,
      userId: leaver,
      projectId: project,
      startedAt: '2026-03-05T00:00:00Z',
      costUsd: '103.000000',
    });
    await seedAgentRequest(leaverSession, '2026-03-05T00:00:00Z', '4.000000');
    await seedAgentRequest(leaverSession, '2026-03-20T00:00:00Z', '99.000000');

    // Early leaver: usage inside the period, but they were already gone before it began.
    const earlySession = await seedAgentSession({
      workspaceId,
      userId: earlyLeaver,
      projectId: project,
      startedAt: '2026-03-05T00:00:00Z',
      costUsd: '7.000000',
    });
    await seedAgentRequest(earlySession, '2026-03-05T00:00:00Z', '7.000000');

    cookie = await seedWebSession(stayer, new Date('2027-01-01T00:00:00Z'));
  });

  afterAll(async () => {
    setSystemTime();
    await truncateAll();
  });

  test('401 without a session cookie', async () => {
    const res = await getSplit(workspaceId, null);
    expect(res.status).toBe(401);
  });

  test('401 with an expired session', async () => {
    const expired = await seedWebSession(stayer, new Date('2026-01-01T00:00:00Z'));
    const res = await getSplit(workspaceId, expired);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'session expired' });
  });

  test('403 for a user with no membership row', async () => {
    const outsider = await seedUser();
    const outsiderCookie = await seedWebSession(outsider.id, new Date('2027-01-01T00:00:00Z'));
    const res = await getSplit(workspaceId, outsiderCookie);
    expect(res.status).toBe(403);
  });

  test('403 for a soft-removed member (left_at set)', async () => {
    const leaverCookie = await seedWebSession(leaver, new Date('2027-01-01T00:00:00Z'));
    const res = await getSplit(workspaceId, leaverCookie);
    expect(res.status).toBe(403);
  });

  test('reports the clamped billing period', async () => {
    const body = (await (await getSplit(workspaceId, cookie)).json()) as SplitBody;
    expect(body.ok).toBe(true);
    expect(body.period).toEqual({ from: PERIOD_FROM, to: PERIOD_TO, daysRemaining: 17 });
  });

  test('lists members who were present for part of the period, drops those who left before it', async () => {
    const body = (await (await getSplit(workspaceId, cookie)).json()) as SplitBody;
    const ids = body.members.map((m) => m.userId);
    expect(ids).toContain(stayer);
    expect(ids).toContain(leaver);
    expect(ids).not.toContain(earlyLeaver);
    expect(body.members).toHaveLength(2);

    const leaverRow = body.members.find((m) => m.userId === leaver)!;
    expect(leaverRow.leftAt).not.toBeNull();
    expect(body.members.find((m) => m.userId === stayer)!.isYou).toBe(true);
  });

  test('clamps a leaver’s usage to the window before left_at', async () => {
    const body = (await (await getSplit(workspaceId, cookie)).json()) as SplitBody;
    const leaverRow = body.members.find((m) => m.userId === leaver)!;
    // 4.00 before left_at counts; the 99.00 request three days after it does not.
    expect(leaverRow.actualUsageCostUsd).toBe(4);
  });

  test('excludes usage from outside the billing period', async () => {
    const body = (await (await getSplit(workspaceId, cookie)).json()) as SplitBody;
    const stayerRow = body.members.find((m) => m.userId === stayer)!;
    expect(stayerRow.actualUsageCostUsd).toBe(10); // the 50.00 from February is not counted
    expect(Number(stayerRow.sessions)).toBe(1);
  });

  test('splits the subscription by in-window usage share', async () => {
    const body = (await (await getSplit(workspaceId, cookie)).json()) as SplitBody;
    expect(body.totals.actualUsageCostUsd).toBe(14);

    const stayerRow = body.members.find((m) => m.userId === stayer)!;
    const leaverRow = body.members.find((m) => m.userId === leaver)!;
    expect(stayerRow.usagePercent).toBe(71.43);
    expect(leaverRow.usagePercent).toBe(28.57);
    expect(stayerRow.subscriptionShareUsd).toBe(142.86);
    expect(leaverRow.subscriptionShareUsd).toBe(57.14);
  });

  test('daily series only covers in-window days for in-period members', async () => {
    const body = (await (await getSplit(workspaceId, cookie)).json()) as SplitBody;
    const dates = body.dailyCost.map((d) => d.date).sort();
    expect(dates).toEqual(['2026-03-05', '2026-03-05']);
    expect(body.dailyCost.every((d) => d.userId !== earlyLeaver)).toBe(true);
  });
});
