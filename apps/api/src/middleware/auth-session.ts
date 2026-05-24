import { and, eq, gt } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { schema } from '@oa/db';
import { db } from '../db';

export interface SessionVars {
  userId: string;
  webSessionId: string;
}

export const COOKIE_NAME = 'oa_session';

export const sessionAuth: MiddlewareHandler<{ Variables: SessionVars }> = async (c, next) => {
  const sid = getCookie(c, COOKIE_NAME);
  if (!sid) return c.json({ ok: false, error: 'not authenticated' }, 401);
  const rows = await db
    .select()
    .from(schema.sessionsWeb)
    .where(and(eq(schema.sessionsWeb.id, sid), gt(schema.sessionsWeb.expiresAt, new Date())))
    .limit(1);
  if (!rows[0]) return c.json({ ok: false, error: 'session expired' }, 401);
  c.set('userId', rows[0].userId);
  c.set('webSessionId', rows[0].id);
  await next();
};
