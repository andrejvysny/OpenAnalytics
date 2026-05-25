import { and, eq } from 'drizzle-orm';
import { schema } from '@oa/db';
import type { Db } from '../db';

// Resolve target workspace for a sync payload:
// - If workspace_id provided, verify user is a member.
// - Otherwise, return the user's personal workspace, creating it if it doesn't exist yet.
export async function resolveWorkspace(
  db: Db,
  userId: string,
  workspaceId: string | null,
): Promise<string> {
  if (workspaceId) {
    const member = await db
      .select({ id: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (member.length === 0) {
      throw new Error('user is not a member of the requested workspace');
    }
    return workspaceId;
  }
  return getOrCreatePersonalWorkspace(db, userId);
}

// Throws if userId is already a member of any non-personal (shared) workspace.
// Used to enforce the "at most one shared workspace per user" rule on create + invite-accept.
export async function assertSingleSharedWorkspace(db: Db, userId: string): Promise<void> {
  const row = await db
    .select({
      workspaceId: schema.workspaceMembers.workspaceId,
      name: schema.workspaces.name,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaces.isPersonal, 0)))
    .limit(1);
  if (row[0]) {
    throw new Error(`already a member of shared workspace "${row[0].name}"`);
  }
}

export async function getOrCreatePersonalWorkspace(db: Db, userId: string): Promise<string> {
  const existing = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .innerJoin(
      schema.workspaceMembers,
      and(
        eq(schema.workspaces.id, schema.workspaceMembers.workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .where(eq(schema.workspaces.isPersonal, 1))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const user = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user[0]) throw new Error('user not found');

  const slugBase = user[0].email
    .split('@')[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-');
  const slug = `${slugBase}-${userId.slice(0, 8)}`;

  const today = new Date().toISOString().slice(0, 10);
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      slug,
      name: `${user[0].name}'s workspace`,
      ownerId: userId,
      isPersonal: 1,
      planKind: 'api',
      planName: 'API (pay-as-you-go)',
      planTier: 'API (pay-as-you-go)',
    })
    .returning({ id: schema.workspaces.id });

  await db.insert(schema.workspaceMembers).values({
    workspaceId: ws!.id,
    userId,
    role: 'owner',
    trackingFrom: today,
  });
  return ws!.id;
}
