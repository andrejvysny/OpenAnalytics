import { createDb } from '@oa/db';
import { env } from './env';

export const db = createDb(env.DATABASE_URL);
export type Db = typeof db;
