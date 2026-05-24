import {
  bigint,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';
import { workspaces } from './workspaces';

export const dailyStats = pgTable(
  'daily_stats',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentKind: varchar('agent_kind', { length: 32 }).notNull(),
    date: date('date').notNull(),
    prompts: integer('prompts').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    cacheCreationTokens: bigint('cache_creation_tokens', { mode: 'number' }).notNull().default(0),
    linesAdded: integer('lines_added').notNull().default(0),
    linesRemoved: integer('lines_removed').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.projectId, t.agentKind, t.date] }),
    index('daily_stats_ws_date_idx').on(t.workspaceId, t.date),
    index('daily_stats_user_date_idx').on(t.userId, t.date),
  ],
);
