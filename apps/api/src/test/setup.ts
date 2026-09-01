// Test-harness bootstrap. Loaded via `bunfig.toml` [test].preload so it runs to
// completion BEFORE any test module is imported — which matters because src/env.ts
// snapshots process.env at import time and src/db.ts opens its pool from that snapshot.
// Nothing here may statically import ../env or ../db (static imports are hoisted and
// would evaluate against the un-rewritten DATABASE_URL).
import { createDb } from '@oa/db';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';

const MIGRATIONS_FOLDER = resolve(import.meta.dir, '../../../../packages/db/migrations');

// The tests run against a dedicated database derived from the normal connection
// string by suffixing the db name, so CI and dev only need DATABASE_URL. The
// `_test` suffix is then enforced: truncateAll() wipes every table in it.
function resolveTestUrl(): URL {
  const explicit = process.env.OA_TEST_DATABASE_URL;
  if (explicit) return new URL(explicit);
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://oa:oa@localhost:5432/oa');
  const name = url.pathname.replace(/^\//, '') || 'oa';
  url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return url;
}

const testUrl = resolveTestUrl();
export const TEST_DB_NAME = testUrl.pathname.replace(/^\//, '');

if (!TEST_DB_NAME.endsWith('_test')) {
  throw new Error(
    `refusing to run tests against "${TEST_DB_NAME}": the test database name must end with _test`,
  );
}

// CREATE DATABASE needs a connection to some other database on the same server.
const adminUrl = new URL(testUrl);
adminUrl.pathname = '/postgres';
const admin = createDb(adminUrl.toString());
try {
  const rows = (await admin.execute(
    sql`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB_NAME}`,
  )) as unknown as unknown[];
  if (rows.length === 0) {
    // Identifier can't be parameterized; TEST_DB_NAME is validated above.
    await admin.execute(sql.raw(`CREATE DATABASE "${TEST_DB_NAME}"`));
  }
} finally {
  await admin.$client.end({ timeout: 5 });
}

// Hand the rewritten URL to every module that reads it after this point.
process.env.DATABASE_URL = testUrl.toString();

// Journaled migrations, same files prod applies via drizzle-kit. Idempotent: the
// migrator skips entries already recorded in drizzle.__drizzle_migrations.
const migrationDb = createDb(testUrl.toString());
try {
  // The migrator's CREATE ... IF NOT EXISTS statements emit a NOTICE on every re-run;
  // they are expected and would otherwise dump a stack-shaped blob above the results.
  await migrationDb.execute(sql`SET client_min_messages TO WARNING`);
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
} finally {
  await migrationDb.$client.end({ timeout: 5 });
}
