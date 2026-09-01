import { beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db, seedUser, truncateAll } from './helpers';

// Guards the harness itself: the suite must never be able to reach a non-test
// database, and truncateAll() must actually leave every table empty.
describe('test harness', () => {
  beforeEach(truncateAll);

  test('runs against a _test database, not the dev/prod one', async () => {
    const rows = (await db.execute(sql`SELECT current_database() AS name`)) as unknown as Array<{
      name: string;
    }>;
    expect(rows[0]?.name).toMatch(/_test$/);
    expect(process.env.DATABASE_URL).toContain(rows[0]!.name);
  });

  test('migrations are applied', async () => {
    const rows = (await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBeGreaterThanOrEqual(14);
  });

  test('truncateAll clears seeded rows', async () => {
    await seedUser();
    await truncateAll();
    const rows = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM users`)) as unknown as Array<{
      n: number;
    }>;
    expect(rows[0]!.n).toBe(0);
  });
});
