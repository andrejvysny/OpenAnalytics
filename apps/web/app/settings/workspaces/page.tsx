import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api, apiPost, readMe } from '../../../lib/api';
import { DashLayout, type Workspace } from '../../../components/Layout';

async function createWorkspaceAction(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '');
  const slug = String(formData.get('slug') ?? '');
  const budget = Number(formData.get('budget') ?? 0);
  const tier = String(formData.get('tier') ?? '');
  await apiPost('/api/workspaces', {
    name,
    slug,
    monthlyBudgetUsd: budget > 0 ? budget : undefined,
    planTier: tier || undefined,
    billingCycleDay: 1,
  });
  redirect('/settings/workspaces');
}

async function createInviteAction(formData: FormData) {
  'use server';
  const workspaceId = String(formData.get('workspaceId') ?? '');
  const role = String(formData.get('role') ?? 'member') as 'owner' | 'member';
  const email = String(formData.get('email') ?? '').trim() || undefined;
  const r = await apiPost<{ ok: boolean; url: string; emailSent?: boolean; emailError?: string }>(
    '/api/invites',
    {
      workspaceId,
      role,
      ...(email ? { email } : {}),
      ttlHours: 168,
    },
  );
  if (r.data?.url) {
    const params = new URLSearchParams({ invited: r.data.url });
    if (r.data.emailSent) params.set('email_sent', '1');
    if (r.data.emailError) params.set('email_error', r.data.emailError);
    redirect(`/settings/workspaces?${params.toString()}`);
  }
  redirect('/settings/workspaces');
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; email_sent?: string; email_error?: string }>;
}) {
  const me = await readMe();
  if (!me) redirect('/login');
  const { invited, email_sent, email_error } = await searchParams;
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];
  const sharedWorkspaces = workspaces.filter((w) => !w.isPersonal);

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>Workspaces</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Shared plans let multiple users track usage against one budget.
          </div>
        </div>
      </div>

      {invited && (
        <div className="notice">
          <h2 style={{ marginTop: 0 }}>Invite link ready</h2>
          <p className="muted" style={{ margin: 0 }}>
            {email_sent
              ? 'Email sent to the invitee. Backup: copy this link too.'
              : 'Copy and share — the recipient signs up, opens the link, accepts.'}
          </p>
          {email_error && (
            <p className="error" style={{ marginTop: 8 }}>
              Email failed: {email_error}
            </p>
          )}
          <div className="copy-block">{invited}</div>
        </div>
      )}

      <div className="panel">
        <h2>Your workspaces</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Tier</th>
              <th>Budget</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.id}>
                <td style={{ fontWeight: 500 }}>{w.name}</td>
                <td>
                  <span className="code">{w.slug}</span>
                </td>
                <td>{w.planTier ?? <span className="muted">—</span>}</td>
                <td>
                  {w.monthlyBudgetUsd ? (
                    `$${w.monthlyBudgetUsd}/mo`
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span className={`pill ${w.role === 'owner' ? '' : 'muted'}`}>
                    {w.role ?? 'member'}
                  </span>
                </td>
                <td>
                  {w.isPersonal ? (
                    <span className="pill muted">personal</span>
                  ) : (
                    <Link href={`/plan/${w.id}`}>view plan →</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-row cols-2" style={{ marginTop: 16 }}>
        <div className="panel" style={{ marginTop: 0 }}>
          <h2>Create shared workspace</h2>
          <form action={createWorkspaceAction}>
            <div className="field">
              <label>Name</label>
              <input name="name" required placeholder="Team Riso" />
            </div>
            <div className="field">
              <label>Slug</label>
              <input name="slug" required pattern="[a-z0-9-]+" placeholder="team-riso" />
            </div>
            <div className="panel-row cols-2">
              <div className="field">
                <label>Monthly budget (USD)</label>
                <input name="budget" type="number" min="0" placeholder="100" />
              </div>
              <div className="field">
                <label>Plan tier</label>
                <input name="tier" placeholder="Max 5x" />
              </div>
            </div>
            <button className="primary" type="submit">
              Create workspace
            </button>
          </form>
        </div>

        <div className="panel" style={{ marginTop: 0 }}>
          <h2>Invite to a workspace</h2>
          {sharedWorkspaces.length === 0 ? (
            <p className="muted">Create a shared workspace first to invite members.</p>
          ) : (
            <form action={createInviteAction}>
              <div className="field">
                <label>Workspace</label>
                <select name="workspaceId" required>
                  {sharedWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Role</label>
                <select name="role" defaultValue="member">
                  <option value="member">member</option>
                  <option value="owner">owner</option>
                </select>
              </div>
              <div className="field">
                <label>Recipient email (optional — sends invite if SMTP is configured)</label>
                <input type="email" name="email" placeholder="teammate@example.com" />
              </div>
              <button className="primary" type="submit">
                Create invite
              </button>
            </form>
          )}
        </div>
      </div>
    </DashLayout>
  );
}
