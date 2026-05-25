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

async function signupAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '');
  const next = safeNext(formData.get('next'));
  const r = await callAuth('/api/auth/signup', { email, password, name });
  if (!r.ok) {
    const qs = new URLSearchParams({ err: '1', ...(next !== '/' ? { next } : {}) });
    redirect(`/signup?${qs.toString()}`);
  }
  await forwardSessionCookie(r.setCookie);
  redirect(next);
}

export default async function SignupPage({
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
        <h1>Create account</h1>
        <p className="sub">Free, self-hosted, open-source.</p>
        {err && <div className="error">Sign-up failed — try a different email.</div>}
        <form action={signupAction}>
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label>Name</label>
            <input type="text" name="name" required autoFocus />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" name="email" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" name="password" required minLength={8} />
          </div>
          <button type="submit" className="primary" style={{ width: '100%' }}>
            Sign up
          </button>
        </form>
        <p className="sub" style={{ marginTop: 18, textAlign: 'center', marginBottom: 0 }}>
          Already have an account?{' '}
          <Link href={next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
