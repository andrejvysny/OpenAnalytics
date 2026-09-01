import { redirect } from 'next/navigation';
import { api, apiDelete, publicApiUrl, readMe } from '../../../lib/api';
import { clearSessionCookie } from '../../../lib/auth-actions';
import { DashLayout, type Workspace } from '../../../components/Layout';

const CONFIRM_PHRASE = 'delete my account';

async function deleteAccountAction(formData: FormData) {
  'use server';
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '')
    .trim()
    .toLowerCase();
  if (confirm !== CONFIRM_PHRASE) {
    redirect(
      `/settings/account?error=${encodeURIComponent(`type "${CONFIRM_PHRASE}" to confirm`)}`,
    );
  }
  const r = await apiDelete('/api/account', { password });
  if (!r.ok) {
    redirect(`/settings/account?error=${encodeURIComponent(r.error ?? 'delete failed')}`);
  }
  // The API already dropped every sessions_web row via cascade; drop the browser
  // cookie too so the next request isn't carrying a dangling session id.
  await clearSessionCookie();
  redirect('/login');
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await readMe();
  if (!me) redirect('/login');
  const { error } = await searchParams;
  const publicApi = await publicApiUrl();
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];
  const ownedShared = workspaces.filter((w) => !w.isPersonal && w.role === 'owner');

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Export everything OpenAnalytics stores about you, or delete it for good.
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <h2>Export your data</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
          A single JSON file with your profile, workspaces and memberships, projects, sessions
          (including the cost breakdown), tool usage and per-language diffs. Per-request and
          per-prompt rows are left out — they can run to tens of thousands per session and every
          number they carry is already rolled up onto the session.
        </p>
        <a className="tab" href={`${publicApi}/api/account/export`}>
          Download JSON export
        </a>
      </div>

      <div className="panel">
        <h2>Danger zone</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
          Deleting your account removes your profile, API keys, workspaces you own, and every
          session, project and prompt statistic tied to you — including your usage inside shared
          plans. This cannot be undone. Export first if you want a copy.
        </p>
        {ownedShared.length > 0 && (
          <p className="muted" style={{ fontSize: 12.5 }}>
            You own the shared workspace{ownedShared.length > 1 ? 's' : ''}{' '}
            <strong>{ownedShared.map((w) => w.name).join(', ')}</strong>. While anyone else is still
            a member, deletion is refused — transfer ownership or remove the members first.
          </p>
        )}
        <form action={deleteAccountAction}>
          <div className="field">
            <label>Current password</label>
            <input type="password" name="password" required autoComplete="current-password" />
          </div>
          <div className="field">
            <label>Type “{CONFIRM_PHRASE}” to confirm</label>
            <input type="text" name="confirm" required placeholder={CONFIRM_PHRASE} />
          </div>
          <button className="primary" type="submit">
            Delete my account
          </button>
        </form>
      </div>
    </DashLayout>
  );
}
