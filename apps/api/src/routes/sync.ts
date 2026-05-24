import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { SyncRequest } from '@oa/schema';
import { db } from '../db';
import { ingestSessions } from '../services/ingest';
import { apiKeyAuth, type AuthVars } from '../middleware/auth-api-key';
import { resolveWorkspace } from '../services/workspace';
import { env } from '../env';

export const syncRoute = new Hono<{ Variables: AuthVars }>();

syncRoute.use('*', apiKeyAuth);

syncRoute.get('/salt', async (c) => {
  const userId = c.get('userId');
  const workspaceId = c.req.query('workspace_id') ?? null;
  const resolvedWorkspaceId = await resolveWorkspace(db, userId, workspaceId);
  const salt = createHmac('sha256', env.SESSION_SECRET)
    .update(`workspace:${resolvedWorkspaceId}`)
    .digest('hex');
  return c.json({ ok: true, workspace_id: resolvedWorkspaceId, salt });
});

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
