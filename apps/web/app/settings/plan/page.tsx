import { redirect } from 'next/navigation';
import { api, apiPatch, readMe } from '../../../lib/api';
import { DashLayout, type Workspace } from '../../../components/Layout';
import { money, num, tokens } from '../../../lib/fmt';
import PlanForm from './PlanForm';
import { PlanHero } from '../../../components/PlanHero';

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

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>My plan</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Pick your Claude subscription and billing day. Used to compute "API-equivalent value
            used" each period.
          </div>
        </div>
      </div>

      <PlanHero
        variant="full"
        planName={subscription.planName}
        cost={totals.actualUsageCostUsd}
        monthly={subscription.monthlyPriceUsd}
        periodFrom={period.from}
        periodTo={period.to}
        daysRemaining={period.daysRemaining}
      />

      <div className="panel">
        <h2>Plan settings</h2>
        <PlanForm
          workspaceId={workspace.id}
          defaultPlanKind={subscription.planKind}
          defaultPriceUsd={subscription.monthlyPriceUsd}
          defaultBillingDay={subscription.billingCycleDay}
          action={updatePlanAction}
        />
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
          <div className="stat" title={`${num(totals.input)} input tokens`}>
            <div className="label">Input tokens</div>
            <div className="value">{tokens(totals.input)}</div>
          </div>
          <div className="stat" title={`${num(totals.output)} output tokens`}>
            <div className="label">Output tokens</div>
            <div className="value">{tokens(totals.output)}</div>
          </div>
          <div className="stat" title={`${num(totals.cacheRead)} cache read tokens`}>
            <div className="label">Cache read</div>
            <div className="value">{tokens(totals.cacheRead)}</div>
          </div>
          <div className="stat" title={`${num(totals.cacheCreation)} cache write tokens`}>
            <div className="label">Cache write</div>
            <div className="value">{tokens(totals.cacheCreation)}</div>
          </div>
        </div>
      </div>
    </DashLayout>
  );
}
