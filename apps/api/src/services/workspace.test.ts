import { beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { schema } from '@oa/db';
import { db, seedMember, seedUser, seedWorkspace, truncateAll } from '../test/helpers';
import {
  WorkspaceAccessError,
  assertSingleSharedWorkspace,
  getOrCreatePersonalWorkspace,
  resolveReadWorkspace,
  resolveWorkspace,
} from './workspace';

async function accessError(fn: () => Promise<unknown>): Promise<WorkspaceAccessError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof WorkspaceAccessError) return err;
    throw err;
  }
  throw new Error('expected a WorkspaceAccessError, but the call resolved');
}

function setLeftAt(workspaceId: string, userId: string, leftAt: Date | null) {
  return db
    .update(schema.workspaceMembers)
    .set({ leftAt })
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    );
}

describe('getOrCreatePersonalWorkspace', () => {
  beforeEach(truncateAll);

  test('creates the personal workspace once and returns it thereafter', async () => {
    const user = await seedUser();
    const first = await getOrCreatePersonalWorkspace(db, user.id);
    const second = await getOrCreatePersonalWorkspace(db, user.id);
    expect(second).toBe(first);

    const rows = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, first));
    expect(rows[0]?.isPersonal).toBe(1);
    expect(rows[0]?.planKind).toBe('api');

    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, first));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('owner');
  });

  test('throws for an unknown user', async () => {
    await expect(
      getOrCreatePersonalWorkspace(db, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('user not found');
  });
});

describe('resolveReadWorkspace', () => {
  beforeEach(truncateAll);

  test('falls back to the personal workspace when no id is supplied', async () => {
    const user = await seedUser();
    const personal = await getOrCreatePersonalWorkspace(db, user.id);
    expect(await resolveReadWorkspace(db, user.id, null)).toBe(personal);
    expect(await resolveReadWorkspace(db, user.id, undefined)).toBe(personal);
    expect(await resolveReadWorkspace(db, user.id, '')).toBe(personal);
  });

  test('400 on a non-UUID workspace id (never a raw 500)', async () => {
    const user = await seedUser();
    const err = await accessError(() => resolveReadWorkspace(db, user.id, 'nope'));
    expect(err.status).toBe(400);
    expect(err.message).toBe('invalid workspace_id');
  });

  test('403 on a workspace the user has no membership row for', async () => {
    const owner = await seedUser();
    const outsider = await seedUser();
    const wsId = await seedWorkspace(owner.id);
    await seedMember(wsId, owner.id, { role: 'owner' });

    const err = await accessError(() => resolveReadWorkspace(db, outsider.id, wsId));
    expect(err.status).toBe(403);
  });
});

describe('workspace_members.left_at soft-remove semantics', () => {
  beforeEach(truncateAll);

  test('a soft-removed member loses read and sync access, and regains it on rejoin', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const wsId = await seedWorkspace(owner.id);
    await seedMember(wsId, owner.id, { role: 'owner' });
    await seedMember(wsId, member.id);

    expect(await resolveReadWorkspace(db, member.id, wsId)).toBe(wsId);
    expect(await resolveWorkspace(db, member.id, wsId)).toBe(wsId);

    await setLeftAt(wsId, member.id, new Date('2026-03-10T00:00:00Z'));
    expect((await accessError(() => resolveReadWorkspace(db, member.id, wsId))).status).toBe(403);
    expect((await accessError(() => resolveWorkspace(db, member.id, wsId))).status).toBe(403);

    // The row is kept (past-period billing still needs it), not deleted.
    const rows = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, wsId));
    expect(rows).toHaveLength(2);

    await setLeftAt(wsId, member.id, null);
    expect(await resolveReadWorkspace(db, member.id, wsId)).toBe(wsId);
  });

  test('assertSingleSharedWorkspace only counts active shared memberships', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const wsId = await seedWorkspace(owner.id);
    await seedMember(wsId, owner.id, { role: 'owner' });
    await seedMember(wsId, member.id);

    await expect(assertSingleSharedWorkspace(db, member.id)).rejects.toThrow(
      /already a member of shared workspace/,
    );

    await setLeftAt(wsId, member.id, new Date('2026-03-10T00:00:00Z'));
    await expect(assertSingleSharedWorkspace(db, member.id)).resolves.toBeUndefined();

    await setLeftAt(wsId, member.id, null);
    await expect(assertSingleSharedWorkspace(db, member.id)).rejects.toThrow();
  });

  test('a personal workspace never blocks joining a shared one', async () => {
    const user = await seedUser();
    await getOrCreatePersonalWorkspace(db, user.id);
    await expect(assertSingleSharedWorkspace(db, user.id)).resolves.toBeUndefined();
  });
});
