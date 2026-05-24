import { eq, and, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { schema } from '@oa/db';
import { db } from '../db';
import { verifyPassword } from '../services/crypto';

export interface AuthVars {
  userId: string;
  apiKeyId: string;
}

export const apiKeyAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const header = c.req.header('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) {
    return c.json({ ok: false, error: 'missing bearer token' }, 401);
  }
  const token = header.slice(7).trim();
  // Format: oa_live_<32hex>. Prefix = first 11 chars ("oa_live_xxx") for lookup, full secret verified via argon2.
  if (!token.startsWith('oa_live_')) {
    return c.json({ ok: false, error: 'invalid token' }, 401);
  }
  const prefix = token.slice(0, 11);

  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.prefix, prefix), isNull(schema.apiKeys.revokedAt)));

  for (const row of rows) {
    if (await verifyPassword(row.secretHash, token)) {
      await db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, row.id));
      c.set('userId', row.userId);
      c.set('apiKeyId', row.id);
      return next();
    }
  }
  return c.json({ ok: false, error: 'invalid token' }, 401);
};
