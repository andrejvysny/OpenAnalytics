import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@oa/db';
import { db } from '../db';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { generateApiKey, hashPassword } from '../services/crypto';

export const apiKeysRoute = new Hono<{ Variables: SessionVars }>();

apiKeysRoute.use('*', sessionAuth);

apiKeysRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await db
    .select({
      id: schema.apiKeys.id,
      prefix: schema.apiKeys.prefix,
      name: schema.apiKeys.name,
      createdAt: schema.apiKeys.createdAt,
      lastUsedAt: schema.apiKeys.lastUsedAt,
    })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt)))
    .orderBy(desc(schema.apiKeys.createdAt));
  return c.json({ ok: true, keys: rows });
});

const Create = z.object({ name: z.string().max(255).optional() });

apiKeysRoute.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = Create.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  const key = generateApiKey();
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      userId,
      prefix: key.prefix,
      secretHash: await hashPassword(key.full),
      name: parsed.data.name ?? null,
    })
    .returning({ id: schema.apiKeys.id, prefix: schema.apiKeys.prefix });
  return c.json({ ok: true, id: row!.id, prefix: row!.prefix, secret: key.full });
});

apiKeysRoute.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, userId)));
  return c.json({ ok: true });
});
