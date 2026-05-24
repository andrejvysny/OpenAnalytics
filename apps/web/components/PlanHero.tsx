import Link from 'next/link';
import { money, moneyExact } from '../lib/fmt';

interface Props {
  variant?: 'slim' | 'full';
  planName: string;
  cost: number;
  monthly: number;
  /** ISO string */
  periodFrom?: string;
  /** ISO string */
  periodTo?: string;
  daysRemaining?: number;
  /** Right-side caption (e.g. "5 members") */
  rightLabel?: string;
  editHref?: string;
  editLabel?: string;
  /** When true (default), the dollar number is theoretical (API-equivalent of a flat-fee plan). */
  apiEquivalent?: boolean;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export function PlanHero({
  variant = 'full',
  planName,
  cost,
  monthly,
  periodFrom,
  periodTo,
  daysRemaining,
  rightLabel,
  editHref,
  editLabel = 'Edit plan',
  apiEquivalent = true,
}: Props) {
  const hasAllowance = monthly > 0;
  const realPercent = hasAllowance ? (cost / monthly) * 100 : 0;
  const ringFill = Math.min(100, Math.max(0, realPercent));
  const overUtilized = hasAllowance && cost > monthly;
  // For a flat-fee subscription, >100% is a WIN — you got more API-equivalent
  // value than the fee. Show this in a positive (green) color, not red.
  const ringColor = overUtilized ? '#34d399' : 'var(--accent)';
  const showPercent = Math.min(realPercent, 99999);
  const multiplier = hasAllowance ? cost / monthly : 0;
  const donutTitle = hasAllowance
    ? apiEquivalent
      ? `${money(cost)} of API-equivalent usage on a ${money(monthly)}/mo subscription (${multiplier.toFixed(1)}× value)`
      : `${realPercent.toFixed(1)}% of monthly fee`
    : 'Pay-as-you-go API · no monthly cap';

  return (
    <div
      className={`panel plan-hero${variant === 'slim' ? ' slim' : ''}${overUtilized ? ' positive' : ''}`}
    >
      {hasAllowance ? (
        <div
          className="donut"
          style={{ background: `conic-gradient(${ringColor} ${ringFill}%, #202532 0)` }}
          title={donutTitle}
        >
          <div className="donut-center">
            <strong>{Math.round(showPercent)}%</strong>
            <span>used</span>
          </div>
        </div>
      ) : (
        <div className="donut" style={{ background: '#202532' }}>
          <div className="donut-center">
            <strong>API</strong>
            <span>no cap</span>
          </div>
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="flex wrap" style={{ gap: 8, alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{planName}</h2>
          {overUtilized && (
            <span
              className="value-pill"
              title="API-equivalent usage exceeds the monthly fee — your subscription is paying off"
            >
              {multiplier >= 10
                ? `${multiplier.toFixed(0)}× value`
                : `${multiplier.toFixed(1)}× value`}
            </span>
          )}
        </div>
        <div className="hero-amount" style={{ marginTop: 6 }} title={moneyExact(cost)}>
          {money(cost)}
          <span className="muted">{hasAllowance ? ` / ${money(monthly)}` : ' · this period'}</span>
        </div>
        {hasAllowance && apiEquivalent && (
          <div className="muted" style={{ marginTop: 2, fontSize: 11.5, fontStyle: 'italic' }}>
            API-equivalent · subscription is flat {money(monthly)}/mo
          </div>
        )}
        <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
          {periodFrom && periodTo ? `${shortDate(periodFrom)} – ${shortDate(periodTo)}` : null}
          {typeof daysRemaining === 'number'
            ? `${periodFrom ? ' · ' : ''}ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
            : null}
          {rightLabel ? `${periodFrom || daysRemaining ? ' · ' : ''}${rightLabel}` : null}
        </div>
      </div>
      {editHref && (
        <div className="flex" style={{ justifyContent: 'flex-end' }}>
          <Link className="tab" href={editHref}>
            {editLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
