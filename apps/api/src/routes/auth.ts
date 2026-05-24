import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@oa/db';
import { deleteCookie, setCookie } from 'hono/cookie';
import { db } from '../db';
import { hashPassword, verifyPassword } from '../services/crypto';
import { getOrCreatePersonalWorkspace } from '../services/workspace';
import { COOKIE_NAME, sessionAuth, type SessionVars } from '../middleware/auth-session';
import { env } from '../env';

export const authRoute = new Hono<{ Variables: SessionVars }>();

const Signup = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(255),
});

const Login = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function newSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function setSessionCookie(c: Context, sid: string) {
  setCookie(c, COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

authRoute.post('/signup', async (c) => {
  const parsed = Signup.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  const { email, password, name } = parsed.data;

  const dup = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (dup[0]) return c.json({ ok: false, error: 'email already registered' }, 409);

  const [u] = await db
    .insert(schema.users)
    .values({ email, name, passwordHash: await hashPassword(password) })
    .returning({ id: schema.users.id });

  await getOrCreatePersonalWorkspace(db, u!.id);

  const sid = newSessionId();
  await db.insert(schema.sessionsWeb).values({
    id: sid,
    userId: u!.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: c.req.header('x-forwarded-for') ?? null,
    ua: c.req.header('user-agent') ?? null,
  });
  setSessionCookie(c, sid);
  return c.json({ ok: true, userId: u!.id });
});

authRoute.post('/login', async (c) => {
  const parsed = Login.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  const { email, password } = parsed.data;

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    return c.json({ ok: false, error: 'invalid credentials' }, 401);
  }

  const sid = newSessionId();
  await db.insert(schema.sessionsWeb).values({
    id: sid,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: c.req.header('x-forwarded-for') ?? null,
    ua: c.req.header('user-agent') ?? null,
  });
  setSessionCookie(c, sid);
  return c.json({ ok: true, userId: user.id });
});

authRoute.post('/logout', sessionAuth, async (c) => {
  const sid = c.get('webSessionId');
  await db.delete(schema.sessionsWeb).where(eq(schema.sessionsWeb.id, sid));
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

authRoute.get('/me', sessionAuth, async (c) => {
  const userId = c.get('userId');
  const u = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return c.json({ ok: true, user: u[0] });
});
