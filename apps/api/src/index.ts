#!/usr/bin/env bun
import { Hono } from 'hono';
import { cors } from 'hono/cors';
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

const app = new Hono();

app.use(
  '*',
  cors({
    origin: [env.PUBLIC_WEB_URL],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'authorization'],
  }),
);

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));
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
console.log(`[api] listening on :${port}`);

if (emailReady()) {
  verifyTransport().then((r) =>
    r.ok ? console.log('[email] SMTP ready') : console.warn('[email] SMTP verify failed:', r.error),
  );
} else {
  console.log('[email] disabled (SMTP_HOST unset)');
}

export default { port, fetch: app.fetch };
