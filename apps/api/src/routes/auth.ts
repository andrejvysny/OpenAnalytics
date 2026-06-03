import { Hono, type Context } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@oa/db';
import { deleteCookie, setCookie } from 'hono/cookie';
import { db } from '../db';
import { hashPassword, sha256Hex, verifyPassword } from '../services/crypto';
import { getOrCreatePersonalWorkspace } from '../services/workspace';
import { emailReady, sendPasswordResetEmail } from '../services/email';
import { COOKIE_NAME, sessionAuth, type SessionVars } from '../middleware/auth-session';
import { rateLimit, clientIp } from '../middleware/rate-limit';
import { env } from '../env';

export const authRoute = new Hono<{ Variables: SessionVars }>();

// Brute-force / abuse protection on the unauthenticated endpoints.
const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });
const signupLimit = rateLimit({ windowMs: 60 * 60_000, max: 5 });

// A valid argon2id hash verified against on unknown-user login so response timing
// does not reveal whether an email exists (user-enumeration oracle). Lazily cached.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  return (dummyHashPromise ??= hashPassword('unused-constant-time-placeholder'));
}

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

authRoute.post('/signup', signupLimit, async (c) => {
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
    ip: clientIp(c),
    ua: c.req.header('user-agent') ?? null,
  });
  setSessionCookie(c, sid);
  return c.json({ ok: true, userId: u!.id });
});

authRoute.post('/login', loginLimit, async (c) => {
  const parsed = Login.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  const { email, password } = parsed.data;

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const user = rows[0];
  if (!user) {
    // Verify against a dummy hash so timing doesn't reveal whether the email exists.
    await verifyPassword(await dummyHash(), password);
    return c.json({ ok: false, error: 'invalid credentials' }, 401);
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    return c.json({ ok: false, error: 'invalid credentials' }, 401);
  }

  const sid = newSessionId();
  await db.insert(schema.sessionsWeb).values({
    id: sid,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: clientIp(c),
    ua: c.req.header('user-agent') ?? null,
  });
  setSessionCookie(c, sid);
  return c.json({ ok: true, userId: user.id });
});

const RESET_TTL_HOURS = 2;

// Request a password-reset link. Enumeration-safe: always returns ok, regardless of
// whether the email maps to an account or whether SMTP is configured.
authRoute.post('/forgot', loginLimit, async (c) => {
  const parsed = z
    .object({ email: z.string().email() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid email' }, 400);

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  if (user && emailReady()) {
    const token = newSessionId(); // 256-bit random; only its hash is stored
    const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 3600_000);
    // Invalidate any prior outstanding tokens for this user, then issue a new one.
    await db
      .update(schema.passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.passwordResets.userId, user.id), isNull(schema.passwordResets.usedAt)));
    await db
      .insert(schema.passwordResets)
      .values({ userId: user.id, tokenHash: sha256Hex(token), expiresAt });
    try {
      await sendPasswordResetEmail(
        parsed.data.email,
        `${env.PUBLIC_WEB_URL}/reset/${token}`,
        RESET_TTL_HOURS,
      );
    } catch (err) {
      console.error('[auth] password reset email failed', err);
    }
  }
  return c.json({ ok: true });
});

const Reset = z.object({ token: z.string().min(32), password: z.string().min(8) });

authRoute.post('/reset', loginLimit, async (c) => {
  const parsed = Reset.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  const tokenHash = sha256Hex(parsed.data.token);

  const userId = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.passwordResets)
      .where(eq(schema.passwordResets.tokenHash, tokenHash))
      .limit(1)
      .for('update');
    if (!row || row.usedAt || new Date(row.expiresAt) < new Date()) return null;
    await tx
      .update(schema.passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(schema.passwordResets.id, row.id));
    await tx
      .update(schema.users)
      .set({ passwordHash: await hashPassword(parsed.data.password) })
      .where(eq(schema.users.id, row.userId));
    // Revoke all existing web sessions so the reset fully locks out anyone else.
    await tx.delete(schema.sessionsWeb).where(eq(schema.sessionsWeb.userId, row.userId));
    return row.userId;
  });

  if (!userId) return c.json({ ok: false, error: 'invalid or expired token' }, 400);
  return c.json({ ok: true });
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
