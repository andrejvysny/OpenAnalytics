import { redirect } from 'next/navigation';
import Link from 'next/link';
import { callAuth, forwardSessionCookie } from '../../lib/auth-actions';
import { BrandRow } from '../../components/Brand';

// Block open-redirects: only same-origin relative paths.
function safeNext(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  if (!s.startsWith('/') || s.startsWith('//')) return '/';
  return s;
}

async function loginAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));
  const r = await callAuth('/api/auth/login', { email, password });
  if (!r.ok) {
    const qs = new URLSearchParams({ err: '1', ...(next !== '/' ? { next } : {}) });
    redirect(`/login?${qs.toString()}`);
  }
  await forwardSessionCookie(r.setCookie);
  redirect(next);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; next?: string }>;
}) {
  const { err, next: nextRaw } = await searchParams;
  const next = safeNext(nextRaw);
  return (
    <div className="auth">
      <div className="auth-card">
        <BrandRow />
        <h1>Welcome back</h1>
        <p className="sub">Sign in to your OpenAnalytics account.</p>
        {err && <div className="error">Invalid email or password.</div>}
        <form action={loginAction}>
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label>Email</label>
            <input type="email" name="email" required autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" name="password" required />
          </div>
          <button type="submit" className="primary" style={{ width: '100%' }}>
            Sign in
          </button>
        </form>
        <p className="sub" style={{ marginTop: 18, textAlign: 'center', marginBottom: 0 }}>
          New here?{' '}
          <Link href={next !== '/' ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}>
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
