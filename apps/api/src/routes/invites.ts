import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { env } from '../env';
import { emailReady, sendInviteEmail } from '../services/email';
import { assertSingleSharedWorkspace } from '../services/workspace';
import { currentPeriodStartIso } from '../services/billing';

export const invitesRoute = new Hono<{ Variables: SessionVars }>();
invitesRoute.use('*', sessionAuth);

function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const Create = z.object({
  workspaceId: z.string().uuid(),
  role: z.enum(['owner', 'member']).default('member'),
  email: z.string().email().optional(),
  trackingFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ttlHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),
});

// Owner creates an invite. Server returns a shareable URL containing the token.
invitesRoute.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = Create.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);

  const owner = await db
    .select({ billingCycleDay: schema.workspaces.billingCycleDay })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, parsed.data.workspaceId),
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.role, 'owner'),
      ),
    )
    .limit(1);
  if (!owner[0]) return c.json({ ok: false, error: 'forbidden' }, 403);

  const token = newToken();
  const trackingFrom = parsed.data.trackingFrom ?? currentPeriodStartIso(owner[0].billingCycleDay);
  const expiresAt = new Date(Date.now() + parsed.data.ttlHours * 3600_000);

  const [row] = await db
    .insert(schema.invites)
    .values({
      workspaceId: parsed.data.workspaceId,
      role: parsed.data.role,
      trackingFrom,
      token,
      expiresAt,
      createdByUserId: userId,
    })
    .returning({ id: schema.invites.id });

  const url = `${env.PUBLIC_WEB_URL}/invite/${token}`;
  let emailSent = false;
  let emailError: string | undefined;
  if (parsed.data.email && emailReady()) {
    try {
      const [ws] = await db
        .select({ name: schema.workspaces.name })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, parsed.data.workspaceId))
        .limit(1);
      const [inviter] = await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      await sendInviteEmail(
        parsed.data.email,
        ws?.name ?? 'OpenAnalytics workspace',
        url,
        inviter?.name ?? 'A teammate',
      );
      emailSent = true;
    } catch (err) {
      emailError = (err as Error).message;
      console.error('[invites] sendInviteEmail failed', emailError);
    }
  }

  return c.json({
    ok: true,
    id: row!.id,
    token,
    url,
    expiresAt: expiresAt.toISOString(),
    emailSent,
    emailError,
  });
});

invitesRoute.get('/:token', async (c) => {
  const token = c.req.param('token');
  const rows = await db
    .select({
      id: schema.invites.id,
      workspaceId: schema.invites.workspaceId,
      role: schema.invites.role,
      trackingFrom: schema.invites.trackingFrom,
      expiresAt: schema.invites.expiresAt,
      acceptedAt: schema.invites.acceptedAt,
      workspaceName: schema.workspaces.name,
    })
    .from(schema.invites)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.invites.workspaceId))
    .where(eq(schema.invites.token, token))
    .limit(1);
  if (!rows[0]) return c.json({ ok: false, error: 'not found' }, 404);
  const inv = rows[0];
  if (inv.acceptedAt) return c.json({ ok: false, error: 'already accepted' }, 410);
  if (new Date(inv.expiresAt) < new Date()) return c.json({ ok: false, error: 'expired' }, 410);
  return c.json({ ok: true, invite: inv });
});

invitesRoute.post('/:token/accept', async (c) => {
  const userId = c.get('userId');
  const token = c.req.param('token');
  const rows = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.token, token))
    .limit(1);
  const inv = rows[0];
  if (!inv) return c.json({ ok: false, error: 'not found' }, 404);
  if (inv.acceptedAt) return c.json({ ok: false, error: 'already accepted' }, 410);
  if (new Date(inv.expiresAt) < new Date()) return c.json({ ok: false, error: 'expired' }, 410);

  const existing = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, inv.workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    try {
      await assertSingleSharedWorkspace(db, userId);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 409);
    }
    await db.insert(schema.workspaceMembers).values({
      workspaceId: inv.workspaceId,
      userId,
      role: inv.role,
      trackingFrom: inv.trackingFrom,
    });
  }
  await db
    .update(schema.invites)
    .set({ acceptedAt: new Date() })
    .where(eq(schema.invites.id, inv.id));
  return c.json({ ok: true, workspaceId: inv.workspaceId });
});
