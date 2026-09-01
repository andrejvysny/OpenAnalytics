import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const memberRole = pgEnum('member_role', ['owner', 'member']);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  planKind: varchar('plan_kind', { length: 32 }).notNull().default('custom'),
  planName: varchar('plan_name', { length: 64 }),
  monthlyPriceUsd: numeric('monthly_price_usd', { precision: 12, scale: 2 }),
  splitMode: varchar('split_mode', { length: 32 }).notNull().default('usage'),
  planTier: varchar('plan_tier', { length: 64 }),
  monthlyBudgetUsd: integer('monthly_budget_usd'),
  billingCycleDay: integer('billing_cycle_day').notNull().default(1),
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),
  isPersonal: integer('is_personal').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('member'),
    expectedShareBps: integer('expected_share_bps'),
    trackingFrom: date('tracking_from').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft-remove marker: membership is ACTIVE iff left_at IS NULL. The row is kept
    // so past-period billing splits still attribute the member's pre-leave usage.
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  // user_id lookup runs on every authenticated page load (workspace list / personal-ws resolve).
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull().default('member'),
  trackingFrom: date('tracking_from').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
