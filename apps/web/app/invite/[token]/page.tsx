import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api, apiPost, readMe } from '../../../lib/api';
import { BrandRow } from '../../../components/Brand';

interface InviteResp {
  ok: boolean;
  invite: {
    id: string;
    workspaceId: string;
    role: string;
    workspaceName: string;
    expiresAt: string;
  };
  error?: string;
}

async function acceptAction(formData: FormData) {
  'use server';
  const token = String(formData.get('token') ?? '');
  const r = await apiPost<{ ok: boolean; workspaceId: string }>(`/api/invites/${token}/accept`, {});
  if (r.ok && r.data?.workspaceId) redirect(`/plan/${r.data.workspaceId}`);
  redirect('/');
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await readMe();

  if (!me) {
    return (
      <div className="auth">
        <div className="auth-card">
          <BrandRow />
          <h1>You've been invited</h1>
          <p className="sub">Create an account or sign in to accept this invite.</p>
          <Link
            href={`/signup?next=/invite/${token}`}
            className="primary"
            style={{
              display: 'block',
              textAlign: 'center',
              padding: 10,
              borderRadius: 6,
              marginTop: 10,
              color: 'white',
              textDecoration: 'none',
            }}
          >
            Sign up
          </Link>
          <p className="sub" style={{ marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
            Already have an account? <Link href={`/login?next=/invite/${token}`}>Sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  const inv = await api<InviteResp>(`/api/invites/${token}`);
  if (!inv?.ok) {
    return (
      <div className="auth">
        <div className="auth-card">
          <BrandRow />
          <h1>Invite invalid</h1>
          <p className="sub">{inv?.error ?? 'This link is no longer valid.'}</p>
          <Link href="/">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <BrandRow />
        <h1>Join workspace</h1>
        <p className="sub">
          You've been invited to <strong>{inv.invite.workspaceName}</strong> as{' '}
          <span className="pill">{inv.invite.role}</span>.
        </p>
        <form action={acceptAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="primary" style={{ width: '100%', marginTop: 8 }}>
            Accept invite
          </button>
        </form>
      </div>
    </div>
  );
}
