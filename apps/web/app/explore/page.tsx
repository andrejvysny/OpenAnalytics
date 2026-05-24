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
              <div className="label">Cache write</div>
              <div className="value">{tokens(data.summary.cacheCreation)}</div>
            </div>
            <div className="stat">
              <div className="label">Cache read</div>
              <div className="value">{tokens(data.summary.cacheRead)}</div>
            </div>
          </div>

          <div className="panel">
            <div className="flex spread" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Daily cost</h2>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {data.daily.length} day{data.daily.length === 1 ? '' : 's'}
              </span>
            </div>
            <DailyChart daily={data.daily} />
          </div>

          <div className="panel-row cols-3" style={{ marginTop: 16 }}>
            <div className="panel scroll-list" style={{ marginTop: 0 }}>
              <h2>Projects</h2>
              <ProportionList
                rows={projects.map((p) => ({
                  label: p.name,
                  value: p.cost,
                  sub: `${num(p.sessions)} session${p.sessions === 1 ? '' : 's'}`,
                  display: money(p.cost),
                }))}
              />
            </div>
            <div className="panel scroll-list" style={{ marginTop: 0 }}>
              <h2>Tools</h2>
              <ProportionList
                rows={data.tools
                  .slice(0, 30)
                  .map((t) => ({ label: t.tool, value: t.count, display: num(t.count) }))}
              />
            </div>
            <div className="panel scroll-list" style={{ marginTop: 0 }}>
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
                  {data.languages.slice(0, 30).map((l) => (
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

interface PropRow {
  label: string;
  value: number;
  display: string;
  sub?: string;
}

function ProportionList({ rows }: { rows: PropRow[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) return <p className="muted">No data.</p>;
  return (
    <div className="prop-list">
      {rows.map((r) => (
        <div key={r.label} className="prop-row">
          <div className="prop-label">
            <div className="prop-name" title={r.label}>
              {r.label}
            </div>
            {r.sub && <div className="prop-sub">{r.sub}</div>}
          </div>
          <div className="prop-value">{r.display}</div>
          <div className="bar-track prop-bar">
            <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyChart({ daily }: { daily: { date: string; cost: number }[] }) {
  if (daily.length === 0) return <p className="muted">No data.</p>;
  const max = Math.max(...daily.map((d) => d.cost), 0.01);
  const niceMax = niceCeil(max);

  // Use viewBox so the SVG scales to the panel width.
  const VB_W = 800;
  const h = 140;
  const padTop = 12;
  const padLeft = 56;
  const padRight = 8;
  const padBottom = 28;
  const totalH = h + padTop + padBottom;
  const plotW = VB_W - padLeft - padRight;
  const slot = plotW / daily.length;
  const barW = Math.min(36, slot * 0.62);

  // Cap labels at ~10 to avoid overlap on dense ranges.
  const labelEveryN = Math.max(1, Math.ceil(daily.length / 10));

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${totalH}`}
      width="100%"
      style={{ display: 'block', height: totalH }}
      preserveAspectRatio="none"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padTop + (1 - t) * h;
        return (
          <g key={t}>
            <line
              x1={padLeft}
              y1={y}
              x2={VB_W - padRight}
              y2={y}
              stroke="#1f232c"
              strokeDasharray={t === 0 ? '0' : '2,3'}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={padLeft - 8}
              y={y}
              fontSize="10"
              fill="#7a818d"
              textAnchor="end"
              dominantBaseline="middle"
            >
              ${formatTick(niceMax * t)}
            </text>
          </g>
        );
      })}
      {daily.map((d, i) => {
        const cx = padLeft + slot * (i + 0.5);
        const x = cx - barW / 2;
        const sh = (d.cost / niceMax) * h;
        const y = padTop + h - sh;
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={barW} height={sh} fill="var(--accent)" rx="2">
              <title>{`${d.date}: $${d.cost.toFixed(2)}`}</title>
            </rect>
            {i % labelEveryN === 0 && (
              <text x={cx} y={padTop + h + 16} textAnchor="middle" fontSize="10" fill="#7a818d">
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Round up to a "nice" number so the top gridline reads cleanly.
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function formatTick(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}
