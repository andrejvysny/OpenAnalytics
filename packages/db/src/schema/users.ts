import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessionsWeb = pgTable('sessions_web', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ip: varchar('ip', { length: 64 }),
  ua: text('ua'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Password-reset tokens. Only the SHA-256 hash of the token is stored; the raw
// token is sent in the email link and never persisted. Single-use + time-limited.
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    secretHash: text('secret_hash').notNull(),
    name: varchar('name', { length: 255 }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // prefix is scanned on every /api/sync auth; user_id backs the key-management list.
  (t) => [index('api_keys_prefix_idx').on(t.prefix), index('api_keys_user_idx').on(t.userId)],
);
