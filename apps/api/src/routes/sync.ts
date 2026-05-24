import { Hono } from 'hono';
import { SyncRequest } from '@oa/schema';
import { db } from '../db';
import { ingestSessions } from '../services/ingest';
import { apiKeyAuth, type AuthVars } from '../middleware/auth-api-key';
import { resolveWorkspace } from '../services/workspace';

export const syncRoute = new Hono<{ Variables: AuthVars }>();

syncRoute.use('*', apiKeyAuth);

syncRoute.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const parsed = SyncRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  }
  const wsId = await resolveWorkspace(db, userId, parsed.data.workspace_id);
  const result = await ingestSessions(db, userId, wsId, parsed.data.sessions);
  return c.json({ ok: true, ...result });
});
