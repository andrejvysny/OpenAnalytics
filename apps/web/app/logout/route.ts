import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function POST() {
  const c = await cookies();
  const sid = c.get('oa_session')?.value;
  if (sid) {
    await fetch(`${API}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `oa_session=${sid}` },
    }).catch(() => null);
  }
  c.delete('oa_session');
  return NextResponse.redirect(
    new URL('/login', process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
  );
}
