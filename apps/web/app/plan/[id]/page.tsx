import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api, readMe } from '../../../lib/api';
import { DashLayout, type Workspace } from '../../../components/Layout';
import { money, num, pct } from '../../../lib/fmt';

interface PlanResp {
  ok: boolean;
  workspace: {
    id: string;
    name: string;
    slug: string;
    planTier: string | null;
    monthlyBudgetUsd: number | null;
    billingCycleDay: number;
    currency: string;
  };
  period: { from: string; to: string };
  total_cost: number;
  members: {
    userId: string;
    role: string;
    name: string;
    email: string;
    cost: number;
    percent: number;
    sessions: number;
    prompts: number;
    input: number;
    output: number;
    cacheRead: number;
    linesAdded: number;
    linesRemoved: number;
    isYou: boolean;
  }[];
  daily: { userId: string; date: string; cost: number }[];
}

const COLORS = ['#4f8cff', '#f5b942', '#3ddc84', '#ff6b6b', '#a26bff', '#33d2ce', '#ff8b3d'];

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await readMe();
  if (!me) redirect('/login');
  const { id } = await params;
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];
  const plan = await api<PlanResp>(`/api/plan/${id}/split`);

  if (!plan) {
    return (
      <DashLayout user={me} workspaces={workspaces}>
        <h1>Not found</h1>
      </DashLayout>
    );
  }

  const w = plan.workspace;
  const used = plan.total_cost;
  const budget = w.monthlyBudgetUsd ?? 0;
  const usedPct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  const overBudget = budget > 0 && used > budget;
  const from = new Date(plan.period.from);
  const to = new Date(plan.period.to);
  const daysRemaining = Math.max(0, Math.ceil((to.getTime() - Date.now()) / 86400000));

  const allDates = Array.from(new Set(plan.daily.map((d) => d.date))).sort();
  const memberColor = new Map<string, string>();
  plan.members.forEach((m, i) => memberColor.set(m.userId, COLORS[i % COLORS.length]!));

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>{w.name}</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            {from.toISOString().slice(0, 10)} → {to.toISOString().slice(0, 10)} · {daysRemaining}d
            left ·{' '}
            <span className="code" style={{ padding: '1px 6px' }}>
              {w.slug}
            </span>
          </div>
        </div>
        <div className="flex">
          {w.planTier && <span className="pill">{w.planTier}</span>}
          <Link href="/settings/workspaces" className="tab">
            settings
          </Link>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat accent" style={{ gridColumn: 'span 2' }}>
          <div className="label">Spend this period</div>
          <div className="value">
            {money(used)}
            {budget > 0 && (
              <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 6 }}>
                / ${budget}
              </span>
            )}
          </div>
          {budget > 0 && (
            <>
              <div className="bar-track" style={{ marginTop: 10 }}>
                <div
                  className="bar-fill"
                  style={{
                    width: `${usedPct}%`,
                    background: overBudget ? 'var(--red)' : 'var(--accent)',
                  }}
                />
              </div>
              <div className="sub" style={{ color: overBudget ? 'var(--red)' : 'var(--muted)' }}>
                {pct(usedPct)} used{overBudget && ' — over budget'}
              </div>
            </>
          )}
        </div>
        <div className="stat">
          <div className="label">Members</div>
          <div className="value">{plan.members.length}</div>
        </div>
        <div className="stat">
          <div className="label">Sessions</div>
          <div className="value">{num(plan.members.reduce((s, m) => s + m.sessions, 0))}</div>
        </div>
        <div className="stat">
          <div className="label">Prompts</div>
          <div className="value">{num(plan.members.reduce((s, m) => s + m.prompts, 0))}</div>
        </div>
      </div>

      <div className="panel">
        <h2>Usage split</h2>
        {plan.members.map((m) => (
          <div key={m.userId} className="member-row">
            <div className="flex spread" style={{ marginBottom: 8 }}>
              <div className="flex">
                <span className="swatch" style={{ background: memberColor.get(m.userId) }} />
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                {m.isYou && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    (you)
                  </span>
                )}
                <span className={`pill ${m.role === 'owner' ? '' : 'muted'}`}>{m.role}</span>
              </div>
              <div className="flex">
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {money(m.cost)}
                </span>
                <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {pct(m.percent)}
                </span>
              </div>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${m.percent}%`, background: memberColor.get(m.userId) }}
              />
            </div>
            <div className="meta">
              {num(m.prompts)} prompts · {num(m.sessions)} sessions ·{' '}
              <span className="diff-plus">+{num(m.linesAdded)}</span>{' '}
              <span className="diff-minus">−{num(m.linesRemoved)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Daily cost by member</h2>
        {allDates.length === 0 ? (
          <p className="muted">No activity in this period yet.</p>
        ) : (
          <DailyCostChart
            dates={allDates}
            members={plan.members}
            daily={plan.daily}
            colors={memberColor}
          />
        )}
      </div>
    </DashLayout>
  );
}

function DailyCostChart({
  dates,
  members,
  daily,
  colors,
}: {
  dates: string[];
  members: PlanResp['members'];
  daily: PlanResp['daily'];
  colors: Map<string, string>;
}) {
  const byDate = new Map<string, Map<string, number>>();
  for (const d of daily) {
    const inner = byDate.get(d.date) ?? new Map<string, number>();
    inner.set(d.userId, (inner.get(d.userId) ?? 0) + d.cost);
    byDate.set(d.date, inner);
  }
  const max = Math.max(
    1,
    ...dates.map((d) => Array.from(byDate.get(d)?.values() ?? [0]).reduce((a, b) => a + b, 0)),
  );

  const width = Math.max(dates.length * 30, 700);
  const padLeft = 64;
  const barW = Math.min(22, (width - padLeft - 8) / dates.length - 4);
  const h = 220;
  const topPad = 10;
  const yTicks = [0.25, 0.5, 0.75, 1];

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={h + topPad + 36} style={{ display: 'block' }}>
          <g transform={`translate(0, ${topPad})`}>
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={padLeft}
                  y1={h - h * t}
                  x2={width - 4}
                  y2={h - h * t}
                  stroke="#1f232c"
                  strokeDasharray="2,3"
                />
                <text
                  x={padLeft - 8}
                  y={h - h * t + 4}
                  fontSize="10"
                  fill="#7a818d"
                  textAnchor="end"
                >
                  ${(max * t).toFixed(max * t > 100 ? 0 : 1)}
                </text>
              </g>
            ))}
            {dates.map((date, i) => {
              const x = padLeft + i * (barW + 4);
              const segments = members.map((m) => ({
                id: m.userId,
                v: byDate.get(date)?.get(m.userId) ?? 0,
              }));
              const total = segments.reduce((s, x) => s + x.v, 0);
              let yOff = 0;
              return (
                <g key={date}>
                  {segments.map((s) => {
                    if (s.v <= 0) return null;
                    const sh = (s.v / max) * h;
                    const y = h - yOff - sh;
                    yOff += sh;
                    return (
                      <rect
                        key={s.id}
                        x={x}
                        y={y}
                        width={barW}
                        height={sh}
                        fill={colors.get(s.id) ?? '#888'}
                        rx="1"
                      >
                        <title>{`${date} · ${members.find((m) => m.userId === s.id)?.name}: $${s.v.toFixed(2)}`}</title>
                      </rect>
                    );
                  })}
                  {total > 0 && <title>{`${date}: $${total.toFixed(2)}`}</title>}
                  {i % 3 === 0 && (
                    <text
                      x={x + barW / 2}
                      y={h + 18}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#7a818d"
                    >
                      {date.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="flex wrap" style={{ marginTop: 14 }}>
        {members.map((m) => (
          <div key={m.userId} className="flex">
            <span className="swatch" style={{ background: colors.get(m.userId) }} />
            <span style={{ fontSize: 12.5 }}>{m.name}</span>
          </div>
        ))}
      </div>
    </>
  );
}
