import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api, readMe } from '../../lib/api';
import { DashLayout, type Workspace } from '../../components/Layout';
import { money, num, tokens } from '../../lib/fmt';

interface ExploreResp {
  ok: boolean;
  from: string;
  to: string;
  summary: Record<string, string | number>;
  daily: { date: string; cost: number; prompts: number; input: number; output: number }[];
  projects: { name: string; cost: number; sessions: number; prompts: number }[];
  tools: { tool: string; count: number }[];
  languages: { ext: string; added: number; removed: number }[];
}

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All-time', days: 3650 },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>;
}) {
  const me = await readMe();
  if (!me) redirect('/login');
  const sp = await searchParams;
  const preset = PRESETS.find((p) => p.label === sp.preset) ?? PRESETS[1]!;
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];

  const to = new Date();
  const from =
    preset.days === 0
      ? new Date(to.getFullYear(), to.getMonth(), to.getDate())
      : new Date(Date.now() - preset.days * 86400000);
  const qs = `from=${from.toISOString()}&to=${to.toISOString()}`;
  const data = await api<ExploreResp>(`/api/explore?${qs}`);

  const projects = (data?.projects ?? []).filter((p) => !UUID_RE.test(p.name));

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <h1>Explore</h1>
        <div className="flex wrap">
          {PRESETS.map((p) => (
            <Link
              key={p.label}
              href={`/explore?preset=${encodeURIComponent(p.label)}`}
              className={`tab${p.label === preset.label ? ' active' : ''}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {!data || Number(data.summary.sessions) === 0 ? (
        <p className="muted">No data in this range.</p>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat accent">
              <div className="label">Cost</div>
              <div className="value">{money(data.summary.cost)}</div>
            </div>
            <div className="stat">
              <div className="label">Sessions</div>
              <div className="value">{num(data.summary.sessions)}</div>
            </div>
            <div className="stat">
              <div className="label">Prompts</div>
              <div className="value">{num(data.summary.prompts)}</div>
            </div>
            <div className="stat">
              <div className="label">Active days</div>
              <div className="value">{num(data.summary.activeDays)}</div>
            </div>
            <div className="stat">
              <div className="label">Input</div>
              <div className="value">{tokens(data.summary.input)}</div>
            </div>
            <div className="stat">
              <div className="label">Output</div>
              <div className="value">{tokens(data.summary.output)}</div>
            </div>
            <div className="stat">
              <div className="label">Cache read</div>
              <div className="value">{tokens(data.summary.cacheRead)}</div>
            </div>
          </div>

          <div className="panel">
            <h2>Daily cost</h2>
            <DailyChart daily={data.daily} />
          </div>

          <div className="panel-row cols-3" style={{ marginTop: 16 }}>
            <div className="panel" style={{ marginTop: 0 }}>
              <h2>Projects</h2>
              <CostTable
                rows={projects.map((p) => ({ label: p.name, count: p.sessions, cost: p.cost }))}
              />
            </div>
            <div className="panel" style={{ marginTop: 0 }}>
              <h2>Tools</h2>
              <table className="data">
                <tbody>
                  {data.tools.slice(0, 20).map((t) => (
                    <tr key={t.tool}>
                      <td>{t.tool}</td>
                      <td className="num">{num(t.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel" style={{ marginTop: 0 }}>
              <h2>Languages</h2>
              <table className="data">
                <thead>
                  <tr>
                    <th>Ext</th>
                    <th style={{ textAlign: 'right' }}>+</th>
                    <th style={{ textAlign: 'right' }}>−</th>
                  </tr>
                </thead>
                <tbody>
                  {data.languages.slice(0, 20).map((l) => (
                    <tr key={l.ext}>
                      <td>
                        <span className="code">{l.ext}</span>
                      </td>
                      <td className="num diff-plus">{num(l.added)}</td>
                      <td className="num diff-minus">{num(l.removed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </DashLayout>
  );
}

function CostTable({ rows }: { rows: { label: string; count: number; cost: number }[] }) {
  const max = Math.max(...rows.map((r) => r.cost), 1);
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Name</th>
          <th style={{ textAlign: 'right' }}>Sessions</th>
          <th style={{ textAlign: 'right' }}>Cost</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 30).map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="num">{num(r.count)}</td>
            <td className="num cost">{money(r.cost)}</td>
            <td style={{ width: 90 }}>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(r.cost / max) * 100}%` }} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DailyChart({ daily }: { daily: { date: string; cost: number }[] }) {
  if (daily.length === 0) return <p className="muted">No data.</p>;
  const max = Math.max(...daily.map((d) => d.cost), 0.01);
  const width = Math.max(daily.length * 28, 600);
  const h = 200;
  const padLeft = 60;
  const barW = Math.min(20, (width - padLeft - 8) / daily.length - 4);

  const yTicks = [0.25, 0.5, 0.75, 1];

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={h + 36} style={{ display: 'block' }}>
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
            <text x={padLeft - 8} y={h - h * t + 4} fontSize="10" fill="#7a818d" textAnchor="end">
              ${(max * t).toFixed(max * t > 100 ? 0 : 1)}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = padLeft + i * (barW + 4);
          const sh = (d.cost / max) * h;
          return (
            <g key={d.date}>
              <rect x={x} y={h - sh} width={barW} height={sh} fill="var(--accent)" rx="2">
                <title>{`${d.date}: $${d.cost.toFixed(2)}`}</title>
              </rect>
              {i % 3 === 0 && (
                <text x={x + barW / 2} y={h + 18} textAnchor="middle" fontSize="10" fill="#7a818d">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
