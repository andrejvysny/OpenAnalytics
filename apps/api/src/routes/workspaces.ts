import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';

export const workspacesRoute = new Hono<{ Variables: SessionVars }>();
workspacesRoute.use('*', sessionAuth);

workspacesRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await db
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      name: schema.workspaces.name,
      role: schema.workspaceMembers.role,
      isPersonal: schema.workspaces.isPersonal,
      planKind: schema.workspaces.planKind,
      planName: schema.workspaces.planName,
      monthlyPriceUsd: schema.workspaces.monthlyPriceUsd,
      splitMode: schema.workspaces.splitMode,
      billingCycleDay: schema.workspaces.billingCycleDay,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(desc(schema.workspaces.createdAt));
  return c.json({
    ok: true,
    workspaces: rows.map((r) => ({
      ...r,
      monthlyPriceUsd: r.monthlyPriceUsd === null ? null : Number(r.monthlyPriceUsd),
    })),
  });
});

const Create = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  planKind: z.enum(['pro', 'max_5x', 'max_20x', 'custom']).default('custom'),
  planName: z.string().max(64).optional(),
  monthlyPriceUsd: z.number().nonnegative().optional(),
  splitMode: z.enum(['usage', 'equal', 'custom_weights']).default('usage'),
  billingCycleDay: z.number().int().min(1).max(28).default(1),
});

workspacesRoute.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = Create.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({
        name: parsed.data.name,
        slug: parsed.data.slug,
        ownerId: userId,
        planKind: parsed.data.planKind,
        planName: parsed.data.planName ?? planNameFor(parsed.data.planKind),
        monthlyPriceUsd: parsed.data.monthlyPriceUsd?.toFixed(2) ?? null,
        monthlyBudgetUsd: parsed.data.monthlyPriceUsd ? Math.round(parsed.data.monthlyPriceUsd) : null,
        splitMode: parsed.data.splitMode,
        planTier: parsed.data.planName ?? planNameFor(parsed.data.planKind),
        billingCycleDay: parsed.data.billingCycleDay,
        isPersonal: 0,
      })
      .returning({ id: schema.workspaces.id });
    await db.insert(schema.workspaceMembers).values({
      workspaceId: ws!.id,
      userId,
      role: 'owner',
      trackingFrom: today,
    });
    return c.json({ ok: true, id: ws!.id });
  } catch (err) {
    return c.json({ ok: false, error: 'slug already in use' }, 409);
  }
});

const Update = z.object({
  name: z.string().min(1).max(255).optional(),
  planKind: z.enum(['pro', 'max_5x', 'max_20x', 'custom']).optional(),
  planName: z.string().max(64).nullable().optional(),
  monthlyPriceUsd: z.number().nonnegative().nullable().optional(),
  splitMode: z.enum(['usage', 'equal', 'custom_weights']).optional(),
  billingCycleDay: z.number().int().min(1).max(28).optional(),
});

workspacesRoute.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const owner = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, id),
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.role, 'owner'),
      ),
    )
    .limit(1);
  if (!owner[0]) return c.json({ ok: false, error: 'forbidden' }, 403);

  const parsed = Update.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  await db
    .update(schema.workspaces)
    .set({
      ...(parsed.data.name && { name: parsed.data.name }),
      ...(parsed.data.planKind !== undefined && { planKind: parsed.data.planKind }),
      ...(parsed.data.planName !== undefined && {
        planName: parsed.data.planName,
        planTier: parsed.data.planName,
      }),
      ...(parsed.data.monthlyPriceUsd !== undefined && {
        monthlyPriceUsd: parsed.data.monthlyPriceUsd?.toFixed(2) ?? null,
        monthlyBudgetUsd:
          parsed.data.monthlyPriceUsd === null ? null : Math.round(parsed.data.monthlyPriceUsd),
      }),
      ...(parsed.data.splitMode !== undefined && { splitMode: parsed.data.splitMode }),
      ...(parsed.data.billingCycleDay !== undefined && {
        billingCycleDay: parsed.data.billingCycleDay,
      }),
    })
    .where(eq(schema.workspaces.id, id));
  return c.json({ ok: true });
});

workspacesRoute.get('/:id/members', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const mem = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(eq(schema.workspaceMembers.workspaceId, id), eq(schema.workspaceMembers.userId, userId)),
    )
    .limit(1);
  if (!mem[0]) return c.json({ ok: false, error: 'forbidden' }, 403);

  const rows = await db
    .select({
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      expectedShareBps: schema.workspaceMembers.expectedShareBps,
      trackingFrom: schema.workspaceMembers.trackingFrom,
      joinedAt: schema.workspaceMembers.joinedAt,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, id));
  return c.json({ ok: true, members: rows });
});

const MemberUpdate = z.object({
  trackingFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expectedShareBps: z.number().int().min(0).max(10000).nullable().optional(),
});

workspacesRoute.patch('/:id/members/:memberId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const memberId = c.req.param('memberId');
  const owner = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, id),
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.role, 'owner'),
      ),
    )
    .limit(1);
  if (!owner[0]) return c.json({ ok: false, error: 'forbidden' }, 403);
  const parsed = MemberUpdate.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  await db
    .update(schema.workspaceMembers)
    .set({
      ...(parsed.data.trackingFrom !== undefined && { trackingFrom: parsed.data.trackingFrom }),
      ...(parsed.data.expectedShareBps !== undefined && {
        expectedShareBps: parsed.data.expectedShareBps,
      }),
    })
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, id),
        eq(schema.workspaceMembers.userId, memberId),
      ),
    );
  return c.json({ ok: true });
});

function planNameFor(kind: 'pro' | 'max_5x' | 'max_20x' | 'custom'): string {
  if (kind === 'pro') return 'Claude Pro';
  if (kind === 'max_5x') return 'Claude Max 5x';
  if (kind === 'max_20x') return 'Claude Max 20x';
  return 'Custom';
}
