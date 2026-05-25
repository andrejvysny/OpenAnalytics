import { Hono } from 'hono';
import { sessionAuth, type SessionVars } from '../middleware/auth-session';
import { emailReady, verifyTransport } from '../services/email';

export const systemRoute = new Hono<{ Variables: SessionVars }>();
systemRoute.use('*', sessionAuth);

systemRoute.get('/email/verify', async (c) => {
  if (!emailReady()) return c.json({ ok: false, error: 'SMTP not configured' });
  const r = await verifyTransport();
  return c.json(r);
});
