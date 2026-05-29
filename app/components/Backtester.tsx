'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { backtest } from '@/lib/backtest';
import { getSettledHistory } from '@/lib/indexer';
import { USDC, type Leg } from '@/lib/types';

export function Backtester({ legs, premium }: { legs: Leg[]; premium: number }) {
  const history = useQuery({
    queryKey: ['settled-history'],
    queryFn: () => getSettledHistory('BTC'),
  });
  const result = history.data ? backtest(legs, premium, history.data.slice(0, 60)) : undefined;
  const bars = result?.pnls.slice(0, 24) ?? [];
  const maxAbs = Math.max(1, ...bars.map((value) => Math.abs(value)));

  return (
    <section className="panel p-4">
      <div className="flex items-center gap-2">
        <BarChart3 size={17} className="blue-text" />
        <div>
          <div className="metric-label">Backtest</div>
          <h2 className="text-base font-semibold">Settled Oracle Replay</h2>
        </div>
      </div>
      {result ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Runs" value={String(result.runs)} />
            <Metric label="Hit Rate" value={`${Math.round(result.hitRate * 100)}%`} />
            <Metric label="Avg P&L" value={`$${(result.avgPnl / USDC).toFixed(2)}`} />
          </div>
          <div className="mt-4 flex h-24 items-end gap-1">
            {bars.map((value, index) => (
              <div
                key={`${value}-${index}`}
                className={value >= 0 ? 'bg-[#3ddc97]' : 'bg-[#ff6b6b]'}
                style={{ height: `${Math.max(4, (Math.abs(value) / maxAbs) * 92)}px`, width: `${100 / Math.max(1, bars.length)}%` }}
                title={`$${(value / USDC).toFixed(2)}`}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-[#8c96a8]">{history.isLoading ? 'Loading settled oracles.' : 'No replay data available.'}</div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface px-3 py-2">
      <div className="metric-label">{label}</div>
      <div className="metric-value mt-1 text-sm">{value}</div>
    </div>
  );
}
