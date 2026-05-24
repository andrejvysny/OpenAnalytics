'use server';
import { cookies } from 'next/headers';

const API =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function forwardSessionCookie(setCookieHeader: string | null) {
  if (!setCookieHeader) return;
  const m = /oa_session=([^;]+)/.exec(setCookieHeader);
  const exp = /Max-Age=(\d+)/.exec(setCookieHeader);
  if (!m) return;
  const c = await cookies();
  c.set('oa_session', m[1]!, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: exp ? Number(exp[1]) : 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete('oa_session');
}

export async function callAuth(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, setCookie: res.headers.get('set-cookie') };
}
