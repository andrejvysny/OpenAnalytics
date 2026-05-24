'use client';

import { useState, type FormEvent } from 'react';

const PRESET_PRICE: Record<string, number | null> = {
  api: null,
  pro: 20,
  max_5x: 100,
  max_20x: 200,
  custom: null,
};

interface Props {
  workspaceId: string;
  defaultPlanKind: string;
  defaultPriceUsd: number;
  defaultBillingDay: number;
  action: (formData: FormData) => Promise<void> | void;
}

export default function PlanForm({
  workspaceId,
  defaultPlanKind,
  defaultPriceUsd,
  defaultBillingDay,
  action,
}: Props) {
  const [planKind, setPlanKind] = useState(defaultPlanKind);
  const [price, setPrice] = useState<string>(defaultPriceUsd ? String(defaultPriceUsd) : '');
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  function onPlanChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const k = e.target.value;
    setPlanKind(k);
    const preset = PRESET_PRICE[k];
    if (preset !== null && preset !== undefined) setPrice(String(preset));
    else if (k === 'api') setPrice('');
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    try {
      await action(fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="panel-row cols-2">
        <div className="field">
          <label>Plan</label>
          <select name="planKind" value={planKind} onChange={onPlanChange}>
            <option value="api">API (pay-as-you-go)</option>
            <option value="pro">Claude Pro ($20/mo)</option>
            <option value="max_5x">Claude Max 5x ($100/mo)</option>
            <option value="max_20x">Claude Max 20x ($200/mo)</option>
            <option value="custom">Custom</option>
          </select>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Choosing a preset auto-fills the price.
          </div>
        </div>
        <div className="field">
          <label>Monthly price (USD)</label>
          <input
            name="monthlyPriceUsd"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="auto"
          />
        </div>
      </div>
      <div className="field" style={{ maxWidth: 360 }}>
        <label>Billing starts on day of month (1–28)</label>
        <input
          name="billingCycleDay"
          type="number"
          min="1"
          max="28"
          defaultValue={defaultBillingDay}
          required
        />
      </div>
      <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
        <button className="primary" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save plan'}
        </button>
        {saved && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            ✓ Saved
          </span>
        )}
      </div>
    </form>
  );
}
