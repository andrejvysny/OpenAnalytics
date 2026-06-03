import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { env } from '../env';
import { emailReady, sendInviteEmail } from '../services/email';
import { currentPeriodStartIso } from '../services/billing';

export const invitesRoute = new Hono<{ Variables: SessionVars }>();
invitesRoute.use('*', sessionAuth);

class InviteError extends Error {
  constructor(
    public status: 404 | 409 | 410,
    message: string,
  ) {
    super(message);
  }
}

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
  try {
    // One transaction with a row lock on the invite: check-then-act must be atomic,
    // otherwise two concurrent accepts can both pass the checks (double-join / break
    // the single-shared-workspace invariant / 500 on duplicate insert).
    const workspaceId = await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(schema.invites)
        .where(eq(schema.invites.token, token))
        .limit(1)
        .for('update');
      if (!inv) throw new InviteError(404, 'not found');
      if (inv.acceptedAt) throw new InviteError(410, 'already accepted');
      if (new Date(inv.expiresAt) < new Date()) throw new InviteError(410, 'expired');

      const [existing] = await tx
        .select({ id: schema.workspaceMembers.userId })
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, inv.workspaceId),
            eq(schema.workspaceMembers.userId, userId),
          ),
        )
        .limit(1);
      if (!existing) {
        // Enforce "at most one shared workspace" inside the same tx.
        const [shared] = await tx
          .select({ name: schema.workspaces.name })
          .from(schema.workspaceMembers)
          .innerJoin(
            schema.workspaces,
            eq(schema.workspaces.id, schema.workspaceMembers.workspaceId),
          )
          .where(
            and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaces.isPersonal, 0)),
          )
          .limit(1);
        if (shared)
          throw new InviteError(409, `already a member of shared workspace "${shared.name}"`);
        await tx.insert(schema.workspaceMembers).values({
          workspaceId: inv.workspaceId,
          userId,
          role: inv.role,
          trackingFrom: inv.trackingFrom,
        });
      }
      await tx
        .update(schema.invites)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invites.id, inv.id));
      return inv.workspaceId;
    });
    return c.json({ ok: true, workspaceId });
  } catch (err) {
    if (err instanceof InviteError) return c.json({ ok: false, error: err.message }, err.status);
    throw err;
  }
});
