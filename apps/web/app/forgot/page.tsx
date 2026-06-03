import Link from 'next/link';
import { redirect } from 'next/navigation';
import { callAuth } from '../../lib/auth-actions';
import { BrandRow } from '../../components/Brand';

async function forgotAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '');
  // Response is intentionally not branched on — the API is enumeration-safe.
  await callAuth('/api/auth/forgot', { email });
  redirect('/forgot?sent=1');
}

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <div className="auth">
      <div className="auth-card">
        <BrandRow />
        <h1>Reset your password</h1>
        <p className="sub">Enter your email and we&apos;ll send you a reset link.</p>
        {sent && (
          <div
            className="sub"
            style={{ padding: '10px 12px', background: '#eef6ff', borderRadius: 6 }}
          >
            If an account exists for that email, a reset link is on its way. The link expires in 2
            hours.
          </div>
        )}
        <form action={forgotAction}>
          <div className="field">
            <label>Email</label>
            <input type="email" name="email" required autoFocus />
          </div>
          <button type="submit" className="primary" style={{ width: '100%' }}>
            Send reset link
          </button>
        </form>
        <p className="sub" style={{ marginTop: 18, textAlign: 'center', marginBottom: 0 }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
