'use client';

import { Layers, TrendingUp } from 'lucide-react';
import { USDC, type Leg, type StructureQuote } from '@/lib/types';

function usd(value: number) {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function strike(value: number) {
  return `$${(value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function StructureSummary({ quote, quoteSource }: { quote?: StructureQuote; quoteSource: string }) {
  if (!quote) {
    return (
      <section className="panel p-4">
        <div className="metric-label">Structure</div>
        <div className="mt-2 text-sm text-[#8c96a8]">Waiting for oracle and quote data.</div>
      </section>
    );
  }

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Structure</div>
          <h2 className="text-base font-semibold">Selected Decomposition</h2>
        </div>
        <div className="surface flex items-center gap-2 px-3 py-2 text-sm">
          <Layers size={16} className="blue-text" />
          {quote.legs.length} legs
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Premium" value={usd(quote.totalCost)} tone="warn-text" />
        <Metric label="Max Loss" value={usd(quote.maxLoss)} tone="danger-text" />
        <Metric label="Max Gain" value={usd(quote.maxGain)} tone="good-text" />
        <Metric label="EV" value={usd(quote.ev)} tone={quote.ev >= 0 ? 'good-text' : 'danger-text'} />
        <Metric label="Saved" value={usd(quote.savingsVsNaive)} tone="blue-text" />
      </div>
      <div className="mt-4 grid gap-2">
        {quote.legs.map((leg, index) => (
          <LegRow key={`${leg.lowerStrike}-${leg.higherStrike}-${index}`} leg={leg} index={index} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-[#8c96a8]">
        <TrendingUp size={14} />
        Quote source: {quoteSource}
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="surface px-3 py-2">
      <div className="metric-label">{label}</div>
      <div className={`metric-value mt-1 text-sm ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

function LegRow({ leg, index }: { leg: Leg; index: number }) {
  const name = leg.isRange ? `Range ${strike(leg.lowerStrike)}-${strike(leg.higherStrike)}` : `${leg.isUp ? 'Up' : 'Down'} ${strike(leg.lowerStrike)}`;
  return (
    <div className="surface flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span>
        {index + 1}. {name}
      </span>
      <span className="metric-value">{usd(leg.quantity)} payout</span>
    </div>
  );
}
