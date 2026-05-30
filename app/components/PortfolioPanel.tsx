'use client';

import { Grid2X2, WalletMinimal } from 'lucide-react';
import { borrowCapacity, portfolioNav, scenarioGrid, type PortfolioPosition } from '@/lib/portfolio';
import { USDC, type OracleState } from '@/lib/types';

function usd(value: number) {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function PortfolioPanel({ oracle, positions }: { oracle: OracleState; positions: PortfolioPosition[] }) {
  const nav = portfolioNav(positions, oracle.svi, oracle.forward);
  const grid = scenarioGrid(positions, oracle.svi, oracle.forward);
  const maxAbs = Math.max(1, ...grid.map((cell) => Math.abs(cell.pnl)));

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Portfolio</div>
          <h2 className="text-base font-semibold">Scenario Grid</h2>
        </div>
        <WalletMinimal size={16} className="blue-text" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="NAV" value={usd(nav.nav)} />
        <Metric label="Floor" value={usd(nav.worstCaseFloor)} tone="good-text" />
        <Metric label="Borrow" value={usd(borrowCapacity(positions, 0.5))} tone="blue-text" />
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1">
        {grid.map((cell) => {
          const alpha = 0.18 + Math.min(0.72, Math.abs(cell.pnl) / maxAbs);
          return (
            <div
              key={`${cell.spotShockPct}-${cell.ivShockPct}`}
              className="rounded-[4px] px-2 py-2 text-center text-[11px] metric-value"
              style={{ background: cell.pnl >= 0 ? `rgba(61, 220, 151, ${alpha})` : `rgba(255, 107, 107, ${alpha})` }}
              title={`Spot ${cell.spotShockPct}% / IV ${cell.ivShockPct}%: ${usd(cell.pnl)}`}
            >
              {cell.spotShockPct > 0 ? '+' : ''}
              {cell.spotShockPct}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-[#8c96a8]">
        <Grid2X2 size={14} />
        Delta {nav.delta.toFixed(2)} · Vega {usd(nav.vega)}
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
