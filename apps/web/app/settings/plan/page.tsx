import { redirect } from 'next/navigation';
import { api, apiPatch, readMe } from '../../../lib/api';
import { DashLayout, type Workspace } from '../../../components/Layout';
import { money, num } from '../../../lib/fmt';

interface PlanMeResp {
  ok: boolean;
  workspace: { id: string; name: string; isPersonal: boolean };
  subscription: {
    planKind: 'api' | 'pro' | 'max_5x' | 'max_20x' | 'custom';
    planName: string;
    monthlyPriceUsd: number;
    billingCycleDay: number;
    currency: string;
  };
  period: { from: string; to: string; daysRemaining: number };
  totals: {
    actualUsageCostUsd: number;
    costUtilizationPercent: number;
    sessions: number;
    prompts: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
}

const PRESETS: Record<string, { label: string; price: number | null }> = {
  api: { label: 'API (pay-as-you-go)', price: null },
  pro: { label: 'Claude Pro', price: 20 },
  max_5x: { label: 'Claude Max 5x', price: 100 },
  max_20x: { label: 'Claude Max 20x', price: 200 },
  custom: { label: 'Custom', price: null },
};

async function updatePlanAction(formData: FormData) {
  'use server';
  const workspaceId = String(formData.get('workspaceId') ?? '');
  const planKind = String(formData.get('planKind') ?? 'api');
  const monthlyPriceRaw = String(formData.get('monthlyPriceUsd') ?? '');
  const billingCycleDay = Number(formData.get('billingCycleDay') ?? 1);
  const presetPrice = PRESETS[planKind]?.price ?? null;
  const monthlyPriceUsd = monthlyPriceRaw === '' ? presetPrice : Number(monthlyPriceRaw);
  await apiPatch(`/api/workspaces/${workspaceId}`, {
    planKind,
    planName: PRESETS[planKind]?.label ?? null,
    monthlyPriceUsd,
    billingCycleDay,
  });
  redirect('/settings/plan');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function Page() {
  const me = await readMe();
  if (!me) redirect('/login');
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];
  const planMe = await api<PlanMeResp>('/api/plan/me');

  if (!planMe) {
    return (
      <DashLayout user={me} workspaces={workspaces}>
        <h1>My plan</h1>
        <p className="muted">Could not load plan details.</p>
      </DashLayout>
    );
  }

  const { subscription, period, totals, workspace } = planMe;
  const used = totals.costUtilizationPercent;
  const ringFill = Math.min(100, Math.max(0, used));
  const hasAllowance = subscription.monthlyPriceUsd > 0;

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>My plan</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Configure your Claude subscription so the Overview can show "API-equivalent value used"
            for the current billing period.
          </div>
        </div>
      </div>

      <div className="panel plan-hero" style={{ marginBottom: 18 }}>
        {hasAllowance ? (
          <div
            className="donut"
            style={{
              background: `conic-gradient(var(--accent) ${ringFill}%, #202532 0)`,
            }}
          >
            <div className="donut-center">
              <strong>{Math.round(used)}%</strong>
              <span>used</span>
            </div>
          </div>
        ) : (
          <div className="donut" style={{ background: '#202532' }}>
            <div className="donut-center">
              <strong>—</strong>
              <span>no cap</span>
            </div>
          </div>
        )}
        <div>
          <div className="flex wrap">
            <h2 style={{ margin: 0 }}>{subscription.planName}</h2>
            <span className="pill">{subscription.planKind}</span>
          </div>
          <div className="hero-amount" style={{ marginTop: 8 }}>
            {money(totals.actualUsageCostUsd)}{' '}
            <span className="muted">
              {hasAllowance ? `/ ${money(subscription.monthlyPriceUsd)}` : '(API-equivalent value)'}
            </span>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Current period: {formatDate(period.from)} – {formatDate(period.to)} · Ends in{' '}
            {num(period.daysRemaining)} day{period.daysRemaining === 1 ? '' : 's'} ·{' '}
            {workspace.name}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Plan settings</h2>
        <form action={updatePlanAction}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <div className="panel-row cols-2">
            <div className="field">
              <label>Plan</label>
              <select name="planKind" defaultValue={subscription.planKind}>
                <option value="api">API (pay-as-you-go)</option>
                <option value="pro">Claude Pro ($20/mo)</option>
                <option value="max_5x">Claude Max 5x ($100/mo)</option>
                <option value="max_20x">Claude Max 20x ($200/mo)</option>
                <option value="custom">Custom</option>
              </select>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Leave the price blank to use the preset default.
              </div>
            </div>
            <div className="field">
              <label>Monthly price (USD)</label>
              <input
                name="monthlyPriceUsd"
                type="number"
                min="0"
                step="0.01"
                defaultValue={subscription.monthlyPriceUsd || ''}
                placeholder="auto"
              />
            </div>
          </div>
          <div className="panel-row cols-2">
            <div className="field">
              <label>Billing starts on day of month (1–28)</label>
              <input
                name="billingCycleDay"
                type="number"
                min="1"
                max="28"
                defaultValue={subscription.billingCycleDay}
                required
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Next billing: {formatDate(period.to)}
              </div>
            </div>
            <div className="field">
              <label>Current period</label>
              <div className="muted" style={{ paddingTop: 6 }}>
                {formatDate(period.from)} – {formatDate(period.to)}
              </div>
            </div>
          </div>
          <button className="primary" type="submit">
            Save plan
          </button>
        </form>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>This period</h2>
        <div className="stats-grid">
          <div className="stat">
            <div className="label">API-equivalent cost</div>
            <div className="value">{money(totals.actualUsageCostUsd)}</div>
          </div>
          <div className="stat">
            <div className="label">Sessions</div>
            <div className="value">{num(totals.sessions)}</div>
          </div>
          <div className="stat">
            <div className="label">Prompts</div>
            <div className="value">{num(totals.prompts)}</div>
          </div>
          <div className="stat">
            <div className="label">Input tokens</div>
            <div className="value">{num(totals.input)}</div>
          </div>
          <div className="stat">
            <div className="label">Output tokens</div>
            <div className="value">{num(totals.output)}</div>
          </div>
          <div className="stat">
            <div className="label">Cache read</div>
            <div className="value">{num(totals.cacheRead)}</div>
          </div>
          <div className="stat">
            <div className="label">Cache write</div>
            <div className="value">{num(totals.cacheCreation)}</div>
          </div>
        </div>
      </div>
    </DashLayout>
  );
}
