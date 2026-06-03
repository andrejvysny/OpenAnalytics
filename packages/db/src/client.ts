import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 30, // seconds — recycle idle connections
    connect_timeout: 10, // seconds — fail fast instead of hanging
    // Pin the session timezone so DATE()/`::timestamptz` casts are unambiguous,
    // regardless of the Postgres image's default TimeZone GUC.
    connection: { TimeZone: 'UTC' },
  });
  // The underlying postgres-js client is reachable via `db.$client` (used for
  // graceful pool shutdown in the API).
  return drizzle(client, { schema });
}
