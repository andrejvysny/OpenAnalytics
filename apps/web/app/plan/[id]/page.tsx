import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api, apiWithStatus, readMe } from '../../../lib/api';
import { DashLayout, type Workspace } from '../../../components/Layout';
import { money, num, pct, tokens } from '../../../lib/fmt';

interface PlanResp {
  ok: boolean;
  workspace: { id: string; name: string; slug: string; isPersonal: number };
  subscription: {
    planKind: string;
    planName: string;
    monthlyPriceUsd: number;
    splitMode: string;
    billingCycleDay: number;
    currency: string;
  };
  period: { from: string; to: string; daysRemaining: number };
  totals: {
    actualUsageCostUsd: number;
    subscriptionPriceUsd: number;
    costUtilizationPercent: number;
    rawTokens: number;
  };
  members: Member[];
  dailyCost: { userId: string; date: string; actualUsageCostUsd: number }[];
  dailyTokens: { userId: string; date: string; tokens: number }[];
}

interface Member {
  userId: string;
  role: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  trackingFrom: string;
  leftAt: string | null;
  expectedSharePercent: number;
  usagePercent: number;
  tokenPercent: number;
  fairShareDeltaPercent: number;
  actualUsageCostUsd: number;
  subscriptionShareUsd: number;
  rawTokens: number;
  sessions: number;
  prompts: number;
  linesAdded: number;
  linesRemoved: number;
  isYou: boolean;
}

const COLORS = ['#4f8cff', '#d89263', '#3ddc84', '#ff6b6b', '#a26bff', '#33d2ce', '#f5b942'];

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await readMe();
  if (!me) redirect('/login');
  const { id } = await params;
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];
  const planRes = await apiWithStatus<PlanResp>(`/api/plan/${id}/split`);
  const plan = planRes.data;

  if (!plan) {
    const title =
      planRes.status === 403
        ? "You don't have access to this workspace"
        : planRes.status === 404
          ? 'Workspace not found'
          : 'Failed to load plan';
    return (
      <DashLayout user={me} workspaces={workspaces}>
        <h1>{title}</h1>
        {process.env.NODE_ENV !== 'production' && planRes.error && (
          <pre className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            HTTP {planRes.status}: {planRes.error}
          </pre>
        )}
      </DashLayout>
    );
  }

  const from = new Date(plan.period.from);
  const to = new Date(plan.period.to);
  const memberColor = new Map<string, string>();
  plan.members.forEach((m, i) => memberColor.set(m.userId, COLORS[i % COLORS.length]!));

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>{plan.workspace.name}</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            {dateRange(from, to)} · {plan.period.daysRemaining}d left ·{' '}
            <span className="code">{plan.workspace.slug}</span>
          </div>
        </div>
        <div className="flex">
          <span className="pill">{plan.subscription.planName}</span>
          <Link href={`/plan/${plan.workspace.id}/settings`} className="tab">
            settings
          </Link>
        </div>
      </div>

      <div className="plan-hero panel">
        <Donut percent={plan.totals.costUtilizationPercent} />
        <div>
          <div className="flex wrap" style={{ marginBottom: 10 }}>
            <h1 style={{ margin: 0 }}>{plan.workspace.name}</h1>
            <span className="pill">{plan.subscription.planName}</span>
          </div>
          <div className="hero-amount">
            {money(plan.totals.actualUsageCostUsd)}{' '}
            <span className="muted">/ {money(plan.subscription.monthlyPriceUsd)}</span>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Estimated cost utilization. Member share uses request-level usage within this billing
            period.
          </div>
          <div className="avatar-stack" style={{ marginTop: 14 }}>
            {plan.members.map((m) => (
              <Avatar key={m.userId} member={m} color={memberColor.get(m.userId) ?? COLORS[0]!} />
            ))}
            <span className="muted">{plan.members.length} members</span>
          </div>
        </div>
        <div className="plan-meta">
          <div>
            <span>Current period</span>
            <strong>{dateRange(from, to)}</strong>
          </div>
          <div>
            <span>Next billing</span>
            <strong>
              {to.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
            </strong>
          </div>
          <div>
            <span>Split mode</span>
            <strong>{splitModeLabel(plan.subscription.splitMode)}</strong>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat accent">
          <div className="label">Estimated cost</div>
          <div className="value">{money(plan.totals.actualUsageCostUsd)}</div>
        </div>
        <div className="stat">
          <div className="label">Tokens</div>
          <div className="value">{tokens(plan.totals.rawTokens)}</div>
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
        <div className="flex spread">
          <h2>Usage split</h2>
          <span className="muted">Total: {money(plan.totals.actualUsageCostUsd)}</span>
        </div>
        {plan.members.map((m) => (
          <div key={m.userId} className="member-row">
            <div className="flex spread" style={{ marginBottom: 8 }}>
              <div className="flex">
                <Avatar member={m} color={memberColor.get(m.userId) ?? COLORS[0]!} />
                <span style={{ fontWeight: 600 }}>{m.name}</span>
                {m.isYou && <span className="muted">(you)</span>}
                <span className={`pill ${m.role === 'owner' ? '' : 'muted'}`}>{m.role}</span>
                {/* Left mid-cycle: their pre-departure usage still counts this period. */}
                {m.leftAt && <span className="pill muted">left</span>}
              </div>
              <div className="flex">
                <span
                  className="cost"
                  style={{ color: memberColor.get(m.userId), fontWeight: 700 }}
                >
                  {money(m.subscriptionShareUsd)} owed
                </span>
                <span className="muted">usage {money(m.actualUsageCostUsd)}</span>
                <span className="muted">{pct(m.usagePercent)}</span>
              </div>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(100, m.usagePercent)}%`,
                  background: memberColor.get(m.userId),
                }}
              />
            </div>
            <div className="meta">
              fair share {pct(m.expectedSharePercent)} · usage delta{' '}
              <span className={m.fairShareDeltaPercent > 0 ? 'diff-minus' : 'diff-plus'}>
                {m.fairShareDeltaPercent > 0 ? '+' : ''}
                {pct(m.fairShareDeltaPercent)}
              </span>{' '}
              · {tokens(m.rawTokens)} · {num(m.prompts)} prompts · {num(m.sessions)} sessions ·{' '}
              <span className="diff-plus">+{num(m.linesAdded)}</span>{' '}
              <span className="diff-minus">−{num(m.linesRemoved)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel-row cols-2" style={{ marginTop: 16 }}>
        <ChartPanel
          title="Daily cost"
          dates={uniqueDates(plan.dailyCost.map((d) => d.date))}
          members={plan.members}
          colors={memberColor}
          values={plan.dailyCost.map((d) => ({
            userId: d.userId,
            date: d.date,
            value: d.actualUsageCostUsd,
          }))}
          moneyAxis
        />
        <ChartPanel
          title="Daily tokens"
          dates={uniqueDates(plan.dailyTokens.map((d) => d.date))}
          members={plan.members}
          colors={memberColor}
          values={plan.dailyTokens.map((d) => ({
            userId: d.userId,
            date: d.date,
            value: d.tokens,
          }))}
        />
      </div>
    </DashLayout>
  );
}

function dateRange(from: Date, to: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${from.toLocaleDateString('en', opts)} – ${to.toLocaleDateString('en', opts)}`;
}

function splitModeLabel(mode: string): string {
  if (mode === 'equal') return 'Equal';
  if (mode === 'custom_weights') return 'Custom weights';
  return 'Usage-based';
}

function uniqueDates(dates: string[]): string[] {
  return Array.from(new Set(dates)).sort();
}

function Avatar({ member, color }: { member: Pick<Member, 'name' | 'avatarUrl'>; color: string }) {
  if (member.avatarUrl) return <img className="avatar small" src={member.avatarUrl} alt="" />;
  return (
    <span className="avatar small" style={{ borderColor: color }}>
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Donut({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="donut" style={{ background: `conic-gradient(var(--accent) ${p}%, #202532 0)` }}>
      <div className="donut-center">
        <strong>{pct(p)}</strong>
        <span>used</span>
      </div>
    </div>
  );
}

function ChartPanel({
  title,
  dates,
  members,
  colors,
  values,
  moneyAxis = false,
}: {
  title: string;
  dates: string[];
  members: Member[];
  colors: Map<string, string>;
  values: { userId: string; date: string; value: number }[];
  moneyAxis?: boolean;
}) {
  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <h2>{title}</h2>
      {dates.length === 0 ? (
        <p className="muted">No activity in this period yet.</p>
      ) : (
        <StackedBarChart
          dates={dates}
          members={members}
          values={values}
          colors={colors}
          moneyAxis={moneyAxis}
        />
      )}
    </div>
  );
}

function StackedBarChart({
  dates,
  members,
  values,
  colors,
  moneyAxis,
}: {
  dates: string[];
  members: Member[];
  values: { userId: string; date: string; value: number }[];
  colors: Map<string, string>;
  moneyAxis: boolean;
}) {
  const byDate = new Map<string, Map<string, number>>();
  for (const v of values) {
    const inner = byDate.get(v.date) ?? new Map<string, number>();
    inner.set(v.userId, (inner.get(v.userId) ?? 0) + v.value);
    byDate.set(v.date, inner);
  }
  const max = Math.max(
    1,
    ...dates.map((d) => Array.from(byDate.get(d)?.values() ?? [0]).reduce((a, b) => a + b, 0)),
  );
  const width = Math.max(dates.length * 30, 580);
  const padLeft = 56;
  const barW = Math.min(22, (width - padLeft - 8) / dates.length - 4);
  const h = 190;
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={h + 36} style={{ display: 'block' }}>
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={padLeft} y1={h - h * t} x2={width - 4} y2={h - h * t} stroke="#1f232c" />
              <text x={padLeft - 8} y={h - h * t + 4} fontSize="10" fill="#7a818d" textAnchor="end">
                {moneyAxis ? `$${(max * t).toFixed(0)}` : tokens(max * t)}
              </text>
            </g>
          ))}
          {dates.map((date, i) => {
            const x = padLeft + i * (barW + 4);
            let yOff = 0;
            return (
              <g key={date}>
                {members.map((m) => {
                  const v = byDate.get(date)?.get(m.userId) ?? 0;
                  if (v <= 0) return null;
                  const sh = (v / max) * h;
                  const y = h - yOff - sh;
                  yOff += sh;
                  return (
                    <rect
                      key={m.userId}
                      x={x}
                      y={y}
                      width={barW}
                      height={sh}
                      fill={colors.get(m.userId)}
                      rx="2"
                    />
                  );
                })}
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
        </svg>
      </div>
      <div className="flex wrap" style={{ marginTop: 10 }}>
        {members.map((m) => (
          <div key={m.userId} className="flex">
            <span className="swatch" style={{ background: colors.get(m.userId) }} />
            <span style={{ fontSize: 12 }}>{m.name}</span>
          </div>
        ))}
      </div>
    </>
  );
}
