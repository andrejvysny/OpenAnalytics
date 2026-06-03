import { z } from 'zod';

// Known-insecure dev defaults. Allowed outside production for zero-config local dev,
// but refused at boot when NODE_ENV=production so a misconfigured deploy fails loudly
// instead of silently shipping a guessable secret (which also seeds the path-hash salt).
export const DEV_SESSION_SECRET = 'dev-secret-change-me-dev-secret-change-me';
const DEV_DATABASE_URL = 'postgres://oa:oa@localhost:5432/oa';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default(DEV_DATABASE_URL),
  SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
  TRUST_PROXY: z.coerce.boolean().default(false),

  // SMTP — if SMTP_HOST is unset, email features are silently disabled.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .optional(),
  SMTP_IGNORE_TLS: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export const env = Env.parse(process.env);

if (env.NODE_ENV === 'production') {
  if (env.SESSION_SECRET === DEV_SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET is still the insecure dev default in production. Set a unique 32+ char secret (e.g. `openssl rand -hex 32`).',
    );
  }
  if (env.DATABASE_URL === DEV_DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is still the dev localhost default in production. Set a real DATABASE_URL.',
    );
  }
}

export type Env = z.infer<typeof Env>;

export const emailEnabled = !!env.SMTP_HOST;
