#!/usr/bin/env bun
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { env } from './env';
import { syncRoute } from './routes/sync';
import { authRoute } from './routes/auth';
import { apiKeysRoute } from './routes/api-keys';
import { overviewRoute } from './routes/overview';
import { exploreRoute } from './routes/explore';
import { heatmapRoute } from './routes/heatmap';
import { planRoute } from './routes/plan';
import { workspacesRoute } from './routes/workspaces';
import { invitesRoute } from './routes/invites';
import { systemRoute } from './routes/system';
import { emailReady, verifyTransport } from './services/email';

const VERSION = '0.1.0';
const app = new Hono();

// Never leak internal error details to clients; log server-side and return a generic 500.
app.onError((err, c) => {
  console.error('[api] unhandled error', err);
  return c.json({ ok: false, error: 'internal server error' }, 500);
});

// Advertise the API version so clients (CLI) can detect version skew.
app.use('*', async (c, next) => {
  c.header('x-oa-api-version', VERSION);
  await next();
});

app.use(
  '*',
  cors({
    origin: [env.PUBLIC_WEB_URL],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'authorization'],
  }),
);

// Liveness: process is up. Readiness (/health): the DB is actually reachable, so an
// orchestrator/proxy can stop routing to a container that can't serve real requests.
app.get('/live', (c) => c.json({ ok: true, version: VERSION }));
app.get('/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ ok: true, version: VERSION });
  } catch (err) {
    console.error('[health] db check failed', err);
    return c.json({ ok: false, error: 'database unavailable' }, 503);
  }
});
app.route('/api/sync', syncRoute);
app.route('/api/auth', authRoute);
app.route('/api/api-keys', apiKeysRoute);
app.route('/api/overview', overviewRoute);
app.route('/api/explore', exploreRoute);
app.route('/api/heatmap', heatmapRoute);
app.route('/api/plan', planRoute);
app.route('/api/workspaces', workspacesRoute);
app.route('/api/invites', invitesRoute);
app.route('/api/system', systemRoute);

const port = env.PORT;
const server = Bun.serve({ port, fetch: app.fetch });
console.log(`[api] listening on :${server.port}`);

if (emailReady()) {
  verifyTransport().then((r) =>
    r.ok ? console.log('[email] SMTP ready') : console.warn('[email] SMTP verify failed:', r.error),
  );
} else {
  console.log('[email] disabled (SMTP_HOST unset)');
}

// Graceful shutdown: stop accepting new connections, let in-flight requests finish,
// then close the DB pool. tini (PID 1) forwards SIGTERM from `docker stop`.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] ${signal} received — draining…`);
  await server.stop();
  try {
    await db.$client.end({ timeout: 5 });
  } catch (err) {
    console.error('[api] error closing db pool', err);
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
