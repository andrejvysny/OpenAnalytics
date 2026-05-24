import { index, numeric, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const modelPrices = pgTable(
  'model_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentKind: varchar('agent_kind', { length: 32 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    inputPerMtok: numeric('input_per_mtok', { precision: 12, scale: 6 }).notNull(),
    outputPerMtok: numeric('output_per_mtok', { precision: 12, scale: 6 }).notNull(),
    cacheReadPerMtok: numeric('cache_read_per_mtok', { precision: 12, scale: 6 }).notNull(),
    cacheWrite5mPerMtok: numeric('cache_write_5m_per_mtok', { precision: 12, scale: 6 }).notNull(),
    cacheWrite1hPerMtok: numeric('cache_write_1h_per_mtok', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    modelFamily: varchar('model_family', { length: 64 }),
    currency: varchar('currency', { length: 8 }).notNull().default('USD'),
  },
  (t) => [
    index('model_prices_lookup_idx').on(t.agentKind, t.model, t.effectiveFrom),
    index('model_prices_family_idx').on(t.agentKind, t.modelFamily, t.effectiveFrom),
  ],
);
