import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Auth backstop: redirects requests without a session cookie to /login.
// Cookie-presence only — no API round trip (this runs on the edge). Per-page
// readMe() calls remain the real gate; this just stops unauthenticated pages
// from ever rendering.
const SESSION_COOKIE = 'oa_session';

const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/forgot',
  '/reset',
  '/invite',
  '/logout',
  '/_next',
  '/favicon',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname) || req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
