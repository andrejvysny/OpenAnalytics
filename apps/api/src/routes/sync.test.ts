import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema } from '@oa/db';
import {
  db,
  makeSessionPayload,
  seedApiKey,
  seedMember,
  seedUser,
  seedWorkspace,
  truncateAll,
  uniqueModel,
} from '../test/helpers';
import { syncRoute } from './sync';

// src/index.ts calls Bun.serve() at module scope, so importing it here would start a
// real listener. Compose the router under test into a throwaway app instead.
function buildApp() {
  return new Hono().route('/api/sync', syncRoute);
}

const app = buildApp();

async function post(body: unknown, token?: string): Promise<Response> {
  return app.request('/api/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sync — auth', () => {
  beforeEach(truncateAll);

  test('401 without an authorization header', async () => {
    const res = await post({ workspace_id: null, sessions: [makeSessionPayload()] });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'missing bearer token' });
  });

  test('401 when the bearer token is not an oa_live key', async () => {
    const res = await post(
      { workspace_id: null, sessions: [makeSessionPayload()] },
      'definitely-not-a-key',
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid token' });
  });

  test('401 when the prefix is known but the secret does not verify', async () => {
    const user = await seedUser();
    const { token } = await seedApiKey(user.id);
    // Keep the 11-char prefix, corrupt the secret body.
    const forged = `${token.slice(0, 11)}${'0'.repeat(token.length - 11)}`;
    const res = await post({ workspace_id: null, sessions: [makeSessionPayload()] }, forged);
    expect(res.status).toBe(401);
  });

  test('401 once the key is revoked', async () => {
    const user = await seedUser();
    const key = await seedApiKey(user.id);
    await db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiKeys.id, key.id));
    const res = await post({ workspace_id: null, sessions: [makeSessionPayload()] }, key.token);
    expect(res.status).toBe(401);
  });

  test('a successful auth stamps last_used_at', async () => {
    const user = await seedUser();
    const key = await seedApiKey(user.id);
    await post({ workspace_id: null, sessions: [makeSessionPayload()] }, key.token);
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));
    expect(row?.lastUsedAt).not.toBeNull();
  });
});

describe('POST /api/sync — envelope + per-session validation', () => {
  beforeEach(truncateAll);

  async function authed() {
    const user = await seedUser();
    const key = await seedApiKey(user.id);
    return { userId: user.id, token: key.token };
  }

  test('400 when the envelope itself is malformed', async () => {
    const { token } = await authed();
    for (const body of [
      { workspace_id: null, sessions: [] }, // min(1)
      { sessions: [makeSessionPayload()] }, // workspace_id is required (nullable, not optional)
      { workspace_id: null }, // sessions is required
    ]) {
      const res = await post(body, token);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    }
  });

  test('ingests the valid sessions of a mixed batch and reports the rest in failed[]', async () => {
    const { token } = await authed();
    const good = makeSessionPayload({ model: uniqueModel('mixed-good') });
    const badUuid = { ...makeSessionPayload(), session_id: 'not-a-uuid' };
    const badHash = { ...makeSessionPayload(), path_hash: 'ZZZZ' };

    const res = await post({ workspace_id: null, sessions: [good, badUuid, badHash] }, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      accepted: number;
      ignored: number;
      failed: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(1);
    expect(body.ignored).toBe(2);
    expect(body.failed).toContain('not-a-uuid');
    expect(body.failed).toContain(badHash.session_id);
    expect(body.failed).not.toContain(good.session_id);

    const rows = await db.select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(good.session_id);
  });

  test('a reject with no usable session_id is reported by index', async () => {
    const { token } = await authed();
    const res = await post({ workspace_id: null, sessions: [{ nonsense: true }] }, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; failed: string[] };
    expect(body.accepted).toBe(0);
    expect(body.failed).toEqual(['invalid:0']);
  });

  test('a null workspace_id creates and targets the personal workspace', async () => {
    const { userId, token } = await authed();
    const res = await post(
      { workspace_id: null, sessions: [makeSessionPayload({ model: uniqueModel('personal') })] },
      token,
    );
    expect(res.status).toBe(200);

    const ws = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.ownerId, userId));
    expect(ws).toHaveLength(1);
    expect(ws[0]?.isPersonal).toBe(1);
  });
});

describe('POST /api/sync — workspace resolution', () => {
  beforeEach(truncateAll);

  test('400 on a workspace_id that is not a UUID', async () => {
    const user = await seedUser();
    const key = await seedApiKey(user.id);
    const res = await post({ workspace_id: 'nope', sessions: [makeSessionPayload()] }, key.token);
    expect(res.status).toBe(400);
  });

  test('403 on a workspace the caller is not a member of', async () => {
    const owner = await seedUser();
    const wsId = await seedWorkspace(owner.id);
    await seedMember(wsId, owner.id, { role: 'owner' });

    const outsider = await seedUser();
    const key = await seedApiKey(outsider.id);
    const res = await post({ workspace_id: wsId, sessions: [makeSessionPayload()] }, key.token);
    expect(res.status).toBe(403);
  });

  test('403 once the caller has been soft-removed from the workspace', async () => {
    const owner = await seedUser();
    const wsId = await seedWorkspace(owner.id);
    await seedMember(wsId, owner.id, { role: 'owner' });
    const leaver = await seedUser();
    await seedMember(wsId, leaver.id, { leftAt: new Date('2026-03-01T00:00:00Z') });
    const key = await seedApiKey(leaver.id);

    const res = await post({ workspace_id: wsId, sessions: [makeSessionPayload()] }, key.token);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/sync/salt', () => {
  beforeEach(truncateAll);

  test('returns a stable per-workspace salt', async () => {
    const user = await seedUser();
    const key = await seedApiKey(user.id);
    const get = () =>
      app.request('/api/sync/salt', { headers: { authorization: `Bearer ${key.token}` } });

    const first = (await (await get()).json()) as {
      ok: boolean;
      workspace_id: string;
      salt: string;
    };
    const second = (await (await get()).json()) as { workspace_id: string; salt: string };
    expect(first.ok).toBe(true);
    expect(first.salt).toMatch(/^[a-f0-9]{64}$/);
    expect(second.salt).toBe(first.salt);
    expect(second.workspace_id).toBe(first.workspace_id);
  });

  test('different workspaces get different salts', async () => {
    const user = await seedUser();
    const key = await seedApiKey(user.id);
    const shared = await seedWorkspace(user.id);
    await seedMember(shared, user.id, { role: 'owner' });

    const personal = (await (
      await app.request('/api/sync/salt', {
        headers: { authorization: `Bearer ${key.token}` },
      })
    ).json()) as { salt: string };
    const sharedSalt = (await (
      await app.request(`/api/sync/salt?workspace_id=${shared}`, {
        headers: { authorization: `Bearer ${key.token}` },
      })
    ).json()) as { salt: string };

    expect(sharedSalt.salt).not.toBe(personal.salt);
  });

  test('401 without a bearer token', async () => {
    const res = await app.request('/api/sync/salt');
    expect(res.status).toBe(401);
  });
});
