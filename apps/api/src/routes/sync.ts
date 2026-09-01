import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHmac } from 'node:crypto';
import { Session, SyncRequestEnvelope } from '@oa/schema';
import { db } from '../db';
import { ingestSessions } from '../services/ingest';
import { apiKeyAuth, type AuthVars } from '../middleware/auth-api-key';
import { rateLimit } from '../middleware/rate-limit';
import { resolveWorkspace, WorkspaceAccessError } from '../services/workspace';
import { env } from '../env';

export const syncRoute = new Hono<{ Variables: AuthVars }>();

syncRoute.use('*', apiKeyAuth);
// Keyed by userId (not IP) — apiKeyAuth above has already resolved it, and a shared
// workspace's members/CI runners can legitimately share an IP. Generous: 120/min/user.
syncRoute.use('*', rateLimit({ windowMs: 60_000, max: 120, key: (c) => c.get('userId') }));

syncRoute.get('/salt', async (c) => {
  const userId = c.get('userId');
  const workspaceId = c.req.query('workspace_id') ?? null;
  let resolvedWorkspaceId: string;
  try {
    resolvedWorkspaceId = await resolveWorkspace(db, userId, workspaceId);
  } catch (e) {
    if (e instanceof WorkspaceAccessError) return c.json({ ok: false, error: e.message }, e.status);
    throw e;
  }
  const salt = createHmac('sha256', env.SESSION_SECRET)
    .update(`workspace:${resolvedWorkspaceId}`)
    .digest('hex');
  return c.json({ ok: true, workspace_id: resolvedWorkspaceId, salt });
});

syncRoute.post(
  '/',
  bodyLimit({
    maxSize: 16 * 1024 * 1024, // 16 MB — metadata-only payloads are tiny; this is generous headroom
    onError: (c) => c.json({ ok: false, error: 'payload too large' }, 413),
  }),
  async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json();
    // Only the envelope gates the request: a batch containing one bad session must
    // still ingest its valid siblings, otherwise the CLI replays the same 400 forever.
    const parsed = SyncRequestEnvelope.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    }
    let wsId: string;
    try {
      wsId = await resolveWorkspace(db, userId, parsed.data.workspace_id);
    } catch (e) {
      if (e instanceof WorkspaceAccessError) {
        return c.json({ ok: false, error: e.message }, e.status);
      }
      throw e;
    }
    const { valid, invalidIds } = partitionSessions(parsed.data.sessions);
    const result = await ingestSessions(db, userId, wsId, valid);
    return c.json({
      ok: true,
      accepted: result.accepted,
      ignored: result.ignored + invalidIds.length,
      failed: [...result.failed, ...invalidIds],
    });
  },
);

interface PartitionedSessions {
  valid: Session[];
  invalidIds: string[];
}

// Split raw payload items into schema-valid sessions and the ids of the rejects, so the
// client can skip exactly the bad ones (they come back in SyncResponse.failed).
function partitionSessions(raw: unknown[]): PartitionedSessions {
  const valid: Session[] = [];
  const invalidIds: string[] = [];
  raw.forEach((item, idx) => {
    const parsed = Session.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    const id = rawSessionId(item) ?? `invalid:${idx}`;
    const issue = parsed.error.issues[0];
    // Log the issue location only — never the payload (metadata-only invariant).
    const detail = issue ? `${issue.path.join('.') || '<root>'}: ${issue.message}` : 'invalid';
    console.warn(`[sync] rejected session ${id}: ${detail}`);
    invalidIds.push(id);
  });
  return { valid, invalidIds };
}

function rawSessionId(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const id = (item as { session_id?: unknown }).session_id;
  return typeof id === 'string' ? id : null;
}
