import Link from 'next/link';
import { redirect } from 'next/navigation';
import { callAuth } from '../../../lib/auth-actions';
import { BrandRow } from '../../../components/Brand';

async function resetAction(formData: FormData) {
  'use server';
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const r = await callAuth('/api/auth/reset', { token, password });
  if (!r.ok) redirect(`/reset/${encodeURIComponent(token)}?err=1`);
  redirect('/login?reset=1');
}

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const { token } = await params;
  const { err } = await searchParams;
  return (
    <div className="auth">
      <div className="auth-card">
        <BrandRow />
        <h1>Set a new password</h1>
        <p className="sub">Choose a new password for your account.</p>
        {err && <div className="error">That reset link is invalid or has expired.</div>}
        <form action={resetAction}>
          <input type="hidden" name="token" value={token} />
          <div className="field">
            <label>New password</label>
            <input type="password" name="password" required minLength={8} autoFocus />
          </div>
          <button type="submit" className="primary" style={{ width: '100%' }}>
            Update password
          </button>
        </form>
        <p className="sub" style={{ marginTop: 18, textAlign: 'center', marginBottom: 0 }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
