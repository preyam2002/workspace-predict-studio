'use client';

import { Activity, Clock3, RefreshCcw } from 'lucide-react';
import type { OracleState } from '@/lib/types';

function dollars(value: number) {
  return `$${(value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function expiryText(expiryMs: number) {
  const delta = expiryMs - Date.now();
  if (delta <= 0) return 'expired';
  const minutes = Math.floor(delta / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function OraclePanel({
  oracle,
  loading,
  error,
  onRefresh,
}: {
  oracle?: OracleState;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
}) {
  return (
    <section className="panel px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="metric-label">Live Oracle</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <Activity size={18} className="blue-text" />
            {oracle ? `${oracle.underlyingAsset} ${oracle.status}` : loading ? 'Loading Predict oracle' : 'Oracle unavailable'}
          </div>
        </div>
        <button className="icon-button" onClick={onRefresh} type="button" title="Refresh oracle">
          <RefreshCcw size={16} />
          Refresh
        </button>
      </div>

      {error ? <div className="danger-text mt-3 text-sm">{error}</div> : null}
      {oracle ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          <Metric label="Spot" value={dollars(oracle.spot)} />
          <Metric label="Forward" value={dollars(oracle.forward)} />
          <Metric label="Min Strike" value={dollars(oracle.minStrike)} />
          <Metric label="Tick" value={dollars(oracle.tickSize)} />
          <Metric label="Expiry" value={expiryText(oracle.expiryMs)} icon={<Clock3 size={14} />} />
          <Metric label="SVI Sigma" value={oracle.svi.sigma.toFixed(6)} />
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="surface px-3 py-2">
      <div className="metric-label">{label}</div>
      <div className="metric-value mt-1 flex items-center gap-1 text-sm">
        {icon}
        {value}
      </div>
    </div>
  );
}
