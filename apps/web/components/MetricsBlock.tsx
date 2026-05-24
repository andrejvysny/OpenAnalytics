import type { ReactNode } from 'react';

export interface MetricRow {
  key: string;
  /** Either a string/number, or fully custom JSX (e.g., diff with green/red spans). */
  value: ReactNode;
  /** Apply the warm "cost" accent to the value. */
  accent?: 'cost';
}

export function MetricsList({ rows }: { rows: MetricRow[] }) {
  return (
    <div className="metrics-list">
      {rows.map((r) => (
        <div className="row" key={r.key}>
          <span className="k">{r.key}</span>
          <span className={`v${r.accent === 'cost' ? ' cost' : ''}`}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Bordered container that hosts a metrics list or right-column card. */
export function MetricCard({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="metric-card">
      <div className="window-dots" aria-hidden="true">
        <span />
        <span />
        <span />
        {label && (
          <span
            style={{
              background: 'transparent',
              width: 'auto',
              height: 'auto',
              marginLeft: 6,
              fontSize: 10.5,
              color: 'var(--muted-2)',
              letterSpacing: '0.04em',
              fontFamily: 'var(--mono)',
            }}
          >
            {label}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Outer panel with header (title + right-side sub) and two-column layout. */
export function MetricPanel({
  title,
  subRight,
  children,
}: {
  title: string;
  subRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="metric-panel">
      <header className="metric-panel-header">
        <h2>{title}</h2>
        {subRight ? <div className="sub">{subRight}</div> : null}
      </header>
      <div className="metric-cols">{children}</div>
    </section>
  );
}
