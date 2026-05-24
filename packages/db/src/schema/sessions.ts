import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';
import { workspaces } from './workspaces';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
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
    host: varchar('host', { length: 255 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    durationS: integer('duration_s').notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    cliVersion: varchar('cli_version', { length: 64 }),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    cacheCreationTokens: bigint('cache_creation_tokens', { mode: 'number' }).notNull().default(0),
    reasoningTokens: bigint('reasoning_tokens', { mode: 'number' }).notNull().default(0),
    linesAdded: integer('lines_added').notNull().default(0),
    linesRemoved: integer('lines_removed').notNull().default(0),
    promptCount: integer('prompt_count').notNull().default(0),
    requestCount: integer('request_count').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    costBreakdown: jsonb('cost_breakdown'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('sessions_ws_started_idx').on(t.workspaceId, t.startedAt),
    index('sessions_user_started_idx').on(t.userId, t.startedAt),
    index('sessions_project_started_idx').on(t.projectId, t.startedAt),
  ],
);

export const prompts = pgTable('prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  length: integer('length').notNull(),
  requestCount: integer('request_count').notNull().default(0),
  command: text('command'),
  skills: jsonb('skills').notNull().default([]),
});

export const requests = pgTable('requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  promptIdx: integer('prompt_idx').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
  cacheCreationTokens: bigint('cache_creation_tokens', { mode: 'number' }).notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  linesAdded: integer('lines_added').notNull().default(0),
  linesRemoved: integer('lines_removed').notNull().default(0),
});

export const toolUsage = pgTable(
  'tool_usage',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tool: varchar('tool', { length: 128 }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.tool] })],
);

export const languageDiffs = pgTable(
  'language_diffs',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    ext: varchar('ext', { length: 32 }).notNull(),
    added: integer('added').notNull(),
    removed: integer('removed').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.ext] })],
);
