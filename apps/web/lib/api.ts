import { cookies, headers } from 'next/headers';

// Server-side fetches need to reach the API on its internal docker hostname,
// which usually differs from the public URL surfaced to browsers.
const API =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const apiUrl = API;

// Server-side fetch that forwards the user's session cookie.
export async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  const c = await cookies();
  const cookieHeader = c
    .getAll()
    .map((x) => `${x.name}=${x.value}`)
    .join('; ');
  const h = new Headers(init?.headers);
  if (cookieHeader) h.set('cookie', cookieHeader);
  const res = await fetch(`${API}${path}`, { ...init, headers: h, cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export interface ApiResult<T> {
  status: number;
  data: T | null;
  error: string | null;
}

export async function apiWithStatus<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const c = await cookies();
  const cookieHeader = c
    .getAll()
    .map((x) => `${x.name}=${x.value}`)
    .join('; ');
  const h = new Headers(init?.headers);
  if (cookieHeader) h.set('cookie', cookieHeader);
  try {
    const res = await fetch(`${API}${path}`, { ...init, headers: h, cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: res.status, data: null, error: text || res.statusText };
    }
    return { status: res.status, data: (await res.json()) as T, error: null };
  } catch (err) {
    return { status: 0, data: null, error: (err as Error).message };
  }
}

// For POST-from-server actions; surfaces error text.
export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; data?: T; error?: string; setCookie?: string }> {
  const c = await cookies();
  const cookieHeader = c
    .getAll()
    .map((x) => `${x.name}=${x.value}`)
    .join('; ');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: text };
  }
  const data = (await res.json()) as T;
  return { ok: true, data, setCookie };
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const c = await cookies();
  const cookieHeader = c
    .getAll()
    .map((x) => `${x.name}=${x.value}`)
    .join('; ');
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, error: await res.text().catch(() => '') };
  return { ok: true, data: (await res.json()) as T };
}

export async function readMe(): Promise<{ id: string; email: string; name: string } | null> {
  const r = await api<{ ok: boolean; user: { id: string; email: string; name: string } }>(
    '/api/auth/me',
  );
  return r?.ok ? r.user : null;
}
