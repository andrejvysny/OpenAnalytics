import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api, apiPatch, readMe } from '../../../../lib/api';
import { DashLayout, type Workspace } from '../../../../components/Layout';

interface MembersResp {
  ok: boolean;
  members: {
    userId: string;
    role: string;
    expectedShareBps: number | null;
    trackingFrom: string;
    joinedAt: string;
    name: string;
    email: string;
  }[];
}

async function updatePlanAction(formData: FormData) {
  'use server';
  const id = String(formData.get('workspaceId') ?? '');
  await apiPatch(`/api/workspaces/${id}`, {
    planKind: String(formData.get('planKind') ?? 'custom'),
    planName: String(formData.get('planName') ?? '') || null,
    monthlyPriceUsd: Number(formData.get('monthlyPriceUsd') ?? 0),
    splitMode: String(formData.get('splitMode') ?? 'usage'),
    billingCycleDay: Number(formData.get('billingCycleDay') ?? 1),
  });
  redirect(`/plan/${id}/settings`);
}

async function updateMemberAction(formData: FormData) {
  'use server';
  const workspaceId = String(formData.get('workspaceId') ?? '');
  const memberId = String(formData.get('memberId') ?? '');
  const expected = String(formData.get('expectedSharePercent') ?? '');
  await apiPatch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
    trackingFrom: String(formData.get('trackingFrom') ?? ''),
    expectedShareBps: expected ? Math.round(Number(expected) * 100) : null,
  });
  redirect(`/plan/${workspaceId}/settings`);
}

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await readMe();
  if (!me) redirect('/login');
  const { id } = await params;
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];
  const workspace = workspaces.find((w) => w.id === id);
  const membersResp = await api<MembersResp>(`/api/workspaces/${id}/members`);
  const members = membersResp?.members ?? [];
  if (!workspace) redirect('/settings/workspaces');

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>Plan settings</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            {workspace.name} · subscription, split mode, and member tracking.
          </div>
        </div>
        <Link href={`/plan/${id}`} className="tab">
          back to plan
        </Link>
      </div>

      <div className="panel">
        <h2>Subscription</h2>
        <form action={updatePlanAction}>
          <input type="hidden" name="workspaceId" value={id} />
          <div className="panel-row cols-2">
            <div className="field">
              <label>Plan preset</label>
              <select name="planKind" defaultValue={workspace.planKind ?? 'custom'}>
                <option value="pro">Claude Pro</option>
                <option value="max_5x">Claude Max 5x</option>
                <option value="max_20x">Claude Max 20x</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="field">
              <label>Plan name</label>
              <input name="planName" defaultValue={workspace.planName ?? ''} placeholder="Claude Max 5x" />
            </div>
          </div>
          <div className="panel-row cols-3">
            <div className="field">
              <label>Monthly price USD</label>
              <input name="monthlyPriceUsd" type="number" step="0.01" min="0" defaultValue={workspace.monthlyPriceUsd ?? 0} />
            </div>
            <div className="field">
              <label>Billing day</label>
              <input name="billingCycleDay" type="number" min="1" max="28" defaultValue={workspace.billingCycleDay ?? 1} />
            </div>
            <div className="field">
              <label>Split mode</label>
              <select name="splitMode" defaultValue={workspace.splitMode ?? 'usage'}>
                <option value="usage">Usage-based</option>
                <option value="equal">Equal</option>
                <option value="custom_weights">Custom weights</option>
              </select>
            </div>
          </div>
          <button className="primary" type="submit">Save subscription</button>
        </form>
      </div>

      <div className="panel">
        <h2>Members</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Tracking from</th>
              <th>Custom weight %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{m.email}</div>
                </td>
                <td><span className={`pill ${m.role === 'owner' ? '' : 'muted'}`}>{m.role}</span></td>
                <td colSpan={3}>
                  <form action={updateMemberAction} className="inline-form">
                    <input type="hidden" name="workspaceId" value={id} />
                    <input type="hidden" name="memberId" value={m.userId} />
                    <input type="date" name="trackingFrom" defaultValue={m.trackingFrom} />
                    <input
                      type="number"
                      name="expectedSharePercent"
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue={m.expectedShareBps === null ? '' : m.expectedShareBps / 100}
                      placeholder="auto"
                    />
                    <button className="ghost" type="submit">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashLayout>
  );
}
