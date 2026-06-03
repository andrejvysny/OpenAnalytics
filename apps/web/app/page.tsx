import { redirect } from 'next/navigation';
import { api, readMe } from '../lib/api';
import { DashLayout, type Workspace } from '../components/Layout';
import { PlanHero } from '../components/PlanHero';
import { MetricCard, MetricPanel, MetricsList } from '../components/MetricsBlock';
import { money, moneyExact, num, tokens } from '../lib/fmt';

interface OverviewResp {
  ok: boolean;
  workspace_id: string;
  today: Record<string, string | number>;
  all_time: Record<string, string | number>;
  top_projects: { id: string; name: string; cost: string; sessions: number; prompts: number }[];
}

interface HeatmapResp {
  ok: boolean;
  year: number;
  days: { date: string; prompts: number; cost: number }[];
}

interface PlanSummaryResp {
  ok: boolean;
  workspace: { id: string; name: string };
  subscription: { planName: string; monthlyPriceUsd: number };
  totals: { actualUsageCostUsd: number; costUtilizationPercent: number; rawTokens: number };
  members: { userId: string }[];
}

interface PlanMeResp {
  ok: boolean;
  workspace: { id: string; name: string; isPersonal: boolean };
  subscription: {
    planKind: 'api' | 'pro' | 'max_5x' | 'max_20x' | 'custom';
    planName: string;
    monthlyPriceUsd: number;
    billingCycleDay: number;
  };
  period: { from: string; to: string; daysRemaining: number };
  totals: { actualUsageCostUsd: number; costUtilizationPercent: number };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page() {
  const me = await readMe();
  if (!me) redirect('/login');
  // Fetch independent resources concurrently (previously a 6-deep sequential waterfall).
  const [wsResp, overview, heat, personalPlan] = await Promise.all([
    api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces'),
    api<OverviewResp>('/api/overview'),
    api<HeatmapResp>('/api/heatmap?year=' + new Date().getUTCFullYear()),
    api<PlanMeResp>('/api/plan/me'),
  ]);
  const workspaces = wsResp?.workspaces ?? [];

  // Shared-plan summaries depend on the workspace list, so they run as a second wave.
  const sharedPlans = await Promise.all(
    workspaces
      .filter((w) => !w.isPersonal)
      .map((w) => api<PlanSummaryResp>(`/api/plan/${w.id}/split`)),
  );
  const activePlan = sharedPlans
    .filter((p): p is PlanSummaryResp => p !== null)
    .sort((a, b) => b.totals.actualUsageCostUsd - a.totals.actualUsageCostUsd)[0];

  if (!overview) {
    return (
      <DashLayout user={me} workspaces={workspaces}>
        <h1>Overview</h1>
        <p className="muted">No data yet. Get started by syncing from the CLI:</p>
        <div className="copy-block">
          oa login --api-url http://localhost:3001 --api-key &lt;your-key&gt;
        </div>
        <div className="copy-block">oa import</div>
      </DashLayout>
    );
  }

  const today = overview.today;
  const all = overview.all_time;

  // Filter & dedupe top projects: drop ones that look like raw UUIDs (no name observed).
  const projectMap = new Map<
    string,
    { name: string; cost: number; sessions: number; prompts: number; id: string }
  >();
  for (const p of overview.top_projects) {
    if (UUID_RE.test(p.name)) continue;
    const key = p.name.toLowerCase();
    const cost = Number(p.cost) || 0;
    const existing = projectMap.get(key);
    if (existing) {
      existing.cost += cost;
      existing.sessions += Number(p.sessions) || 0;
      existing.prompts += Number(p.prompts) || 0;
    } else {
      projectMap.set(key, {
        id: p.id,
        name: p.name,
        cost,
        sessions: Number(p.sessions) || 0,
        prompts: Number(p.prompts) || 0,
      });
    }
  }
  const projects = Array.from(projectMap.values()).sort((a, b) => b.cost - a.cost);
  const maxCost = Math.max(...projects.map((p) => p.cost), 1);
  const maxPrompts = Math.max(...(heat?.days.map((d) => d.prompts) ?? [0]), 1);

  const personalWs = workspaces.find((w) => w.id === overview.workspace_id);

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {personalWs?.name ?? 'Personal workspace'}
          </div>
        </div>
      </div>

      {activePlan ? (
        <PlanHero
          variant="slim"
          planName={activePlan.subscription.planName}
          cost={activePlan.totals.actualUsageCostUsd}
          monthly={activePlan.subscription.monthlyPriceUsd}
          rightLabel={`${activePlan.members.length} members`}
          editHref={`/plan/${activePlan.workspace.id}`}
          editLabel="Open plan"
          apiEquivalent
        />
      ) : personalPlan ? (
        <PlanHero
          variant="slim"
          planName={personalPlan.subscription.planName}
          cost={personalPlan.totals.actualUsageCostUsd}
          monthly={personalPlan.subscription.monthlyPriceUsd}
          periodFrom={personalPlan.period.from}
          periodTo={personalPlan.period.to}
          daysRemaining={personalPlan.period.daysRemaining}
          editHref="/settings/plan"
          apiEquivalent={
            personalPlan.subscription.planKind !== 'api' &&
            personalPlan.subscription.planKind !== 'custom'
          }
        />
      ) : null}

      <div className="section-label">Today</div>
      <div className="stats-grid">
        <div className="stat">
          <div className="label">Cost</div>
          <div className="value">{money(today.cost)}</div>
        </div>
        <div className="stat">
          <div className="label">Sessions</div>
          <div className="value">{num(today.sessions)}</div>
        </div>
        <div className="stat">
          <div className="label">Prompts</div>
          <div className="value">{num(today.prompts)}</div>
        </div>
        <div className="stat">
          <div className="label">Lines</div>
          <div className="value">
            <span className="diff-plus">+{num(today.added)}</span>{' '}
            <span className="diff-minus">−{num(today.removed)}</span>
          </div>
        </div>
        <div
          className="stat"
          title="Anthropic 'input_tokens' — uncached residual only (the rest is served from cache)"
        >
          <div className="label">New input</div>
          <div className="value">{tokens(today.input)}</div>
        </div>
        <div
          className="stat"
          title="input + cache_read + cache_write — total tokens Claude actually saw"
        >
          <div className="label">Context processed</div>
          <div className="value">
            {tokens(Number(today.input) + Number(today.cache_read) + Number(today.cache_creation))}
          </div>
        </div>
        <div className="stat">
          <div className="label">Output tokens</div>
          <div className="value">{tokens(today.output)}</div>
        </div>
        <div className="stat" title="5-minute and 1-hour TTL cache writes">
          <div className="label">Cache write</div>
          <div className="value">{tokens(today.cache_creation)}</div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
            5m {tokens(today.cache_creation_5m)} · 1h {tokens(today.cache_creation_1h)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Cache read</div>
          <div className="value">{tokens(today.cache_read)}</div>
        </div>
      </div>

      <CostBreakdown
        title="Today cost breakdown"
        input={Number(today.cost_input)}
        output={Number(today.cost_output)}
        cacheRead={Number(today.cost_cache_read)}
        cache5m={Number(today.cost_cache_creation_5m)}
        cache1h={Number(today.cost_cache_creation_1h)}
        total={Number(today.cost)}
      />

      <div className="section-label">All-time</div>
      <div className="stats-grid">
        <div className="stat accent">
          <div className="label">Cost</div>
          <div className="value">{money(all.cost)}</div>
        </div>
        <div className="stat">
          <div className="label">Sessions</div>
          <div className="value">{num(all.sessions)}</div>
        </div>
        <div className="stat">
          <div className="label">Prompts</div>
          <div className="value">{num(all.prompts)}</div>
        </div>
        <div className="stat">
          <div className="label">Active days</div>
          <div className="value">{num(all.activeDays)}</div>
        </div>
        <div
          className="stat"
          title="Anthropic 'input_tokens' — uncached residual only (the rest is served from cache)"
        >
          <div className="label">New input</div>
          <div className="value">{tokens(all.input)}</div>
        </div>
        <div
          className="stat"
          title="input + cache_read + cache_write — total tokens Claude actually saw"
        >
          <div className="label">Context processed</div>
          <div className="value">
            {tokens(Number(all.input) + Number(all.cache_read) + Number(all.cache_creation))}
          </div>
        </div>
        <div className="stat">
          <div className="label">Output tokens</div>
          <div className="value">{tokens(all.output)}</div>
        </div>
        <div className="stat" title="5-minute and 1-hour TTL cache writes">
          <div className="label">Cache write</div>
          <div className="value">{tokens(all.cache_creation)}</div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
            5m {tokens(all.cache_creation_5m)} · 1h {tokens(all.cache_creation_1h)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Cache read</div>
          <div className="value">{tokens(all.cache_read)}</div>
        </div>
      </div>

      <CostBreakdown
        title="All-time cost breakdown"
        input={Number(all.cost_input)}
        output={Number(all.cost_output)}
        cacheRead={Number(all.cost_cache_read)}
        cache5m={Number(all.cost_cache_creation_5m)}
        cache1h={Number(all.cost_cache_creation_1h)}
        total={Number(all.cost)}
      />

      <div className="panel">
        <div className="flex spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Activity · {heat?.year}</h2>
          {heat && (
            <div className="heatmap-legend">
              <span>less</span>
              <div className="scale">
                <div style={{ background: 'rgba(255,255,255,0.04)' }} />
                <div style={{ background: 'rgba(79,140,255,0.22)' }} />
                <div style={{ background: 'rgba(79,140,255,0.45)' }} />
                <div style={{ background: 'rgba(79,140,255,0.75)' }} />
                <div style={{ background: 'var(--accent)' }} />
              </div>
              <span>more</span>
            </div>
          )}
        </div>
        {heat ? (
          <Heatmap days={heat.days} max={maxPrompts} year={heat.year} />
        ) : (
          <p className="muted">No data</p>
        )}
      </div>

      <div className="panel">
        <h2>Top projects</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Project</th>
              <th style={{ textAlign: 'right' }}>Sessions</th>
              <th style={{ textAlign: 'right' }}>Prompts</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {projects.slice(0, 25).map((p) => {
              const w = (p.cost / maxCost) * 100;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num">{num(p.sessions)}</td>
                  <td className="num">{num(p.prompts)}</td>
                  <td className="num cost">{money(p.cost)}</td>
                  <td style={{ width: 160 }}>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${w}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashLayout>
  );
}

function CostBreakdown({
  title,
  input,
  output,
  cacheRead,
  cache5m,
  cache1h,
  total,
}: {
  title: string;
  input: number;
  output: number;
  cacheRead: number;
  cache5m: number;
  cache1h: number;
  total: number;
}) {
  if (total <= 0) return null;
  const rows: { label: string; cost: number; hint: string }[] = [
    { label: 'New input', cost: input, hint: 'base input rate × uncached tokens' },
    { label: 'Output', cost: output, hint: '5× base input rate' },
    { label: 'Cache read', cost: cacheRead, hint: '0.1× base input rate' },
    { label: 'Cache write · 5m', cost: cache5m, hint: '1.25× base input rate' },
    { label: 'Cache write · 1h', cost: cache1h, hint: '2× base input rate' },
  ];
  const max = Math.max(...rows.map((r) => r.cost), 1);
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 15 }}>{title}</h2>
      <table className="data">
        <tbody>
          {rows.map((r) => {
            const pctTotal = total > 0 ? (r.cost / total) * 100 : 0;
            const w = (r.cost / max) * 100;
            return (
              <tr key={r.label}>
                <td title={r.hint}>{r.label}</td>
                <td className="num cost">{moneyExact(r.cost)}</td>
                <td className="num muted" style={{ width: 70 }}>
                  {pctTotal.toFixed(1)}%
                </td>
                <td style={{ width: 200 }}>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${w}%` }} />
                  </div>
                </td>
              </tr>
            );
          })}
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td>
              <strong>Total</strong>
            </td>
            <td className="num cost">
              <strong>{moneyExact(total)}</strong>
            </td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Heatmap({
  days,
  max,
  year,
}: {
  days: { date: string; prompts: number }[];
  max: number;
  year: number;
}) {
  const start = new Date(Date.UTC(year, 0, 1));
  const map = new Map(days.map((d) => [d.date, d.prompts]));
  // Align week start: day-of-week of Jan 1 → put weekday rows correctly
  const startDow = start.getUTCDay();
  const cells: { date: string; prompts: number; visible: boolean }[] = [];
  for (let w = 0; w < 53; w++) {
    for (let d = 0; d < 7; d++) {
      const dayIndex = w * 7 + d - startDow;
      const dt = new Date(start.getTime() + dayIndex * 86400000);
      if (dt.getUTCFullYear() !== year) {
        cells.push({ date: '', prompts: 0, visible: false });
      } else {
        const k = dt.toISOString().slice(0, 10);
        cells.push({ date: k, prompts: map.get(k) ?? 0, visible: true });
      }
    }
  }
  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        {cells.map((c, i) => {
          if (!c.visible) return <div key={i} style={{ visibility: 'hidden' }} />;
          const r = c.prompts / max;
          const lvl = c.prompts === 0 ? 0 : r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1;
          return (
            <div
              key={i}
              className={`cell${lvl ? ' l' + lvl : ''}`}
              title={`${c.date}: ${c.prompts} prompts`}
            />
          );
        })}
      </div>
    </div>
  );
}
