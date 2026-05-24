import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default('postgres://oa:oa@localhost:5432/oa'),
  SESSION_SECRET: z.string().min(32).default('dev-secret-change-me-dev-secret-change-me'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
  TRUST_PROXY: z.coerce.boolean().default(false),

  // SMTP — if SMTP_HOST is unset, email features are silently disabled.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export const env = Env.parse(process.env);

export type Env = z.infer<typeof Env>;

export const emailEnabled = !!env.SMTP_HOST;
