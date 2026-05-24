import { redirect } from 'next/navigation';
import Link from 'next/link';
import { callAuth, forwardSessionCookie } from '../../lib/auth-actions';
import { BrandRow } from '../../components/Brand';

async function loginAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const r = await callAuth('/api/auth/login', { email, password });
  if (!r.ok) redirect('/login?err=1');
  await forwardSessionCookie(r.setCookie);
  redirect('/');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const { err } = await searchParams;
  return (
    <div className="auth">
      <div className="auth-card">
        <BrandRow />
        <h1>Welcome back</h1>
        <p className="sub">Sign in to your OpenAnalytics account.</p>
        {err && <div className="error">Invalid email or password.</div>}
        <form action={loginAction}>
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
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
