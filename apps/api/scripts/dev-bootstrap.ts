#!/usr/bin/env bun
// Dev helper: create a user + api key. Prints credentials to stdout.
import { createDb, schema } from '@oa/db';
import { eq } from 'drizzle-orm';
import { hashPassword, generateApiKey } from '../src/services/crypto';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://oa:oa@localhost:5432/oa';
const email = process.argv[2] ?? 'dev@example.com';
const password = process.argv[3] ?? 'dev-password';
const name = process.argv[4] ?? 'Dev User';

const db = createDb(DATABASE_URL);

const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
let userId: string;
if (existing[0]) {
  userId = existing[0].id;
  console.log('user exists', userId);
} else {
  const [u] = await db
    .insert(schema.users)
    .values({ email, name, passwordHash: await hashPassword(password) })
    .returning({ id: schema.users.id });
  userId = u!.id;
  console.log('user created', userId);
}

const key = generateApiKey();
await db.insert(schema.apiKeys).values({
  userId,
  prefix: key.prefix,
  secretHash: await hashPassword(key.full),
  name: 'dev key',
});

console.log('email:    ', email);
console.log('password: ', password);
console.log('userId:   ', userId);
console.log('apiKey:   ', key.full);
process.exit(0);
