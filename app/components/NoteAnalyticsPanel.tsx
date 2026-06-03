'use client';

import { Activity, LineChart } from 'lucide-react';
import { noteAnalytics } from '@/lib/note-analytics';
import { USDC, type Leg, type OracleState } from '@/lib/types';

function money(value: number) {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function metric(value: number, digits = 4) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function NoteAnalyticsPanel({ legs, premium, oracle }: { legs: Leg[]; premium: number; oracle: OracleState }) {
  const analytics = noteAnalytics({ legs, premium, oracle });
  const greeks = analytics.greeks;

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Risk</div>
          <h2 className="text-base font-semibold">Note Greeks</h2>
        </div>
        <Activity size={18} className="blue-text" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Metric label="Mark" value={money(greeks.mark)} />
        <Metric label="Delta" value={metric(greeks.delta / USDC, 6)} />
        <Metric label="Gamma" value={metric(greeks.gamma / USDC, 8)} />
        <Metric label="Vega" value={money(greeks.vega)} />
        <Metric label="Theta/day" value={money(greeks.theta)} />
        <Metric label="Expiry" value={`${Math.max(0, analytics.tauYears * 365).toFixed(1)}d`} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs metric-label">
        <LineChart size={14} />
        <span>Payoff extrema</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <Metric label="Max loss" value={money(analytics.payoff.maxLoss)} tone="danger-text" />
        <Metric label="Max gain" value={money(analytics.payoff.maxGain)} tone="good-text" />
      </div>
    </section>
  );
}

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="surface px-3 py-2">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone}`}>{value}</div>
    </div>
  );
}
