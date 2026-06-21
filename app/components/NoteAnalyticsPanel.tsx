'use client';

import { Activity, LineChart } from 'lucide-react';
import { noteAnalytics } from '@/lib/note-analytics';
import { USDC, type Leg, type OracleState } from '@/lib/types';

function money(value: number) {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function metric(value: number, digits = 4) {
  // Round first, then strip negative zero so tiny greeks read "0" not "-0".
  const rounded = Number(value.toFixed(digits));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return safe.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function NoteAnalyticsPanel({ legs, premium, oracle }: { legs: Leg[]; premium: number; oracle: OracleState }) {
  const analytics = noteAnalytics({ legs, premium, oracle });
  const greeks = analytics.greeks;

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Risk</div>
          <h2 className="text-base font-semibold">Risk estimate</h2>
        </div>
        <Activity size={18} className="blue-text" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Metric label="Mark" value={money(greeks.mark)} title="Estimated value right now." />
        <Metric label="Delta" value={metric(greeks.delta / USDC, 6)} title="Estimated change if BTC moves a little." />
        <Metric label="Gamma" value={metric(greeks.gamma / USDC, 8)} title="Estimated change in delta." />
        <Metric label="Vega" value={money(greeks.vega)} title="Estimated change if volatility moves." />
        <Metric label="Theta/day" value={money(greeks.theta)} title="Estimated value lost or gained per day." />
        <Metric label="Expiry" value={`${Math.max(0, analytics.tauYears * 365).toFixed(1)}d`} title="Time left until settlement." />
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

function Metric({ label, value, tone = '', title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className="surface min-w-0 px-3 py-2" title={title}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value truncate ${tone}`}>{value}</div>
    </div>
  );
}
