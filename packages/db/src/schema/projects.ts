import { index, integer, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pathHash: varchar('path_hash', { length: 16 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    disabled: integer('disabled').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('projects_ws_user_hash_uq').on(t.workspaceId, t.ownerUserId, t.pathHash),
    index('projects_ws_active_idx').on(t.workspaceId, t.lastActiveAt),
  ],
);
