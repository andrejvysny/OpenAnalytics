import { Hono } from 'hono';
import { and, eq, ne } from 'drizzle-orm';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { schema } from '@oa/db';
import { db } from '../db';
import { COOKIE_NAME, sessionAuth, type SessionVars } from '../middleware/auth-session';
import { rateLimit } from '../middleware/rate-limit';
import { verifyPassword } from '../services/crypto';
import { activeMember } from '../services/workspace';

export const accountRoute = new Hono<{ Variables: SessionVars }>();

// Both endpoints are heavy (full-account read / irreversible write) and neither is
// called in a loop by the UI, so the window is deliberately tight.
accountRoute.use('*', rateLimit({ windowMs: 60_000, max: 10 }));
accountRoute.use('*', sessionAuth);

// Per-request rows are intentionally left out: a single session can hold tens of
// thousands of them, and every number they carry is already rolled up onto the
// session row. Same reasoning for per-prompt rows (count + length live on the session).
const EXPORT_INCLUDES = [
  'user',
  'workspaces',
  'memberships',
  'projects',
  'sessions',
  'tool_usage',
  'language_diffs',
] as const;
const EXPORT_EXCLUDES = [
  'requests (per-request rows — aggregated into sessions.*_tokens / cost_usd)',
  'prompts (per-prompt rows — aggregated into sessions.prompt_count)',
  'password_hash',
  'api key secrets',
] as const;

async function exportUser(userId: string) {
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row ?? null;
}

// Every workspace the user belongs to, paired with their own membership row.
// Other members' rows are somebody else's data and stay out of the file.
async function exportWorkspaces(userId: string) {
  return db
    .select({ workspace: schema.workspaces, membership: schema.workspaceMembers })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId));
}

// Child rows are reached through the user's own sessions, so shared workspaces
// never leak a teammate's sessions into the export.
async function exportSessionChildren(userId: string) {
  const toolUsage = await db
    .select({
      sessionId: schema.toolUsage.sessionId,
      tool: schema.toolUsage.tool,
      count: schema.toolUsage.count,
    })
    .from(schema.toolUsage)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.toolUsage.sessionId))
    .where(eq(schema.sessions.userId, userId));
  const languageDiffs = await db
    .select({
      sessionId: schema.languageDiffs.sessionId,
      ext: schema.languageDiffs.ext,
      added: schema.languageDiffs.added,
      removed: schema.languageDiffs.removed,
    })
    .from(schema.languageDiffs)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.languageDiffs.sessionId))
    .where(eq(schema.sessions.userId, userId));
  return { toolUsage, languageDiffs };
}

accountRoute.get('/export', async (c) => {
  const userId = c.get('userId');
  const user = await exportUser(userId);
  if (!user) return c.json({ ok: false, error: 'user not found' }, 404);

  const workspaces = await exportWorkspaces(userId);
  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.ownerUserId, userId));
  const sessions = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(schema.sessions.startedAt);
  const { toolUsage, languageDiffs } = await exportSessionChildren(userId);

  const today = new Date().toISOString().slice(0, 10);
  c.header('content-disposition', `attachment; filename="oa-export-${today}.json"`);
  return c.json({
    meta: {
      exported_at: new Date().toISOString(),
      includes: EXPORT_INCLUDES,
      excludes: EXPORT_EXCLUDES,
    },
    user,
    workspaces: workspaces.map((w) => w.workspace),
    memberships: workspaces.map((w) => w.membership),
    projects,
    sessions,
    tool_usage: toolUsage,
    language_diffs: languageDiffs,
  });
});

const DeleteAccount = z.object({ password: z.string().min(1) });

accountRoute.delete('/', async (c) => {
  const userId = c.get('userId');
  const parsed = DeleteAccount.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: 'password required' }, 400);

  // argon2 verify is deliberately slow — do it before opening the transaction.
  const [user] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
    return c.json({ ok: false, error: 'invalid password' }, 401);
  }

  const blocked = await db.transaction(async (tx) => {
    // Owned shared workspaces cascade-delete everything inside them, including other
    // members' sessions. Refuse while anyone else is still in one. Checked inside the
    // transaction so a concurrent invite acceptance can't slip in behind the guard.
    const others = await tx
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .innerJoin(
        schema.workspaceMembers,
        and(
          eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
          ne(schema.workspaceMembers.userId, userId),
          activeMember,
        ),
      )
      .where(and(eq(schema.workspaces.ownerId, userId), eq(schema.workspaces.isPersonal, 0)))
      .limit(1);
    if (others[0]) return true;

    // Owned workspaces first: workspaces.owner_id is ON DELETE RESTRICT, so the user
    // row cannot go while any of them survives. Deleting the user then cascades
    // sessions_web / api_keys / password_resets / memberships / sessions elsewhere.
    await tx.delete(schema.workspaces).where(eq(schema.workspaces.ownerId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
    return false;
  });

  if (blocked) {
    return c.json(
      { ok: false, error: 'transfer or remove members from shared workspace first' },
      409,
    );
  }

  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});
