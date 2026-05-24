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
      planTier: schema.workspaces.planTier,
      monthlyBudgetUsd: schema.workspaces.monthlyBudgetUsd,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(desc(schema.workspaces.createdAt));
  return c.json({ ok: true, workspaces: rows });
});

const Create = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  monthlyBudgetUsd: z.number().int().nonnegative().optional(),
  planTier: z.string().max(64).optional(),
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
        monthlyBudgetUsd: parsed.data.monthlyBudgetUsd ?? null,
        planTier: parsed.data.planTier ?? null,
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
  monthlyBudgetUsd: z.number().int().nonnegative().nullable().optional(),
  planTier: z.string().max(64).nullable().optional(),
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
      ...(parsed.data.monthlyBudgetUsd !== undefined && {
        monthlyBudgetUsd: parsed.data.monthlyBudgetUsd,
      }),
      ...(parsed.data.planTier !== undefined && { planTier: parsed.data.planTier }),
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
