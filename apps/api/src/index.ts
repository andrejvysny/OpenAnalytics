#!/usr/bin/env bun
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
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
import { accountRoute } from './routes/account';
import { systemRoute } from './routes/system';
import { emailReady, verifyTransport } from './services/email';

const VERSION = '0.1.0';

interface AppVars {
  requestId: string;
}
const app = new Hono<{ Variables: AppVars }>();

// Never leak internal error details to clients; log server-side and return a generic 500.
// request_id ties this line back to the per-request access log line below.
app.onError((err, c) => {
  console.error(`[api] unhandled error request_id=${c.get('requestId')}`, err);
  return c.json({ ok: false, error: 'internal server error' }, 500);
});

// Baseline security headers for a JSON-only API. No CSP (no HTML is ever served).
// HSTS is intentionally left off: Caddy terminates TLS in prod and sets it there.
app.use(
  '*',
  secureHeaders({
    strictTransportSecurity: false,
  }),
);

// One line per request for log correlation: method, path, status, duration, request id.
// The id also goes out as `x-request-id` so a client-reported issue can be traced server-side.
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${durationMs}ms ${requestId}`);
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

// Global request body cap for every route except /api/sync, which keeps its own generous
// 16 MB route-level limit (metadata batches can be large; everything else is small JSON).
const defaultBodyLimit = bodyLimit({
  maxSize: 256 * 1024,
  onError: (c) => c.json({ ok: false, error: 'payload too large' }, 413),
});
app.use('*', (c, next) =>
  c.req.path.startsWith('/api/sync') ? next() : defaultBodyLimit(c, next),
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
app.route('/api/account', accountRoute);
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
