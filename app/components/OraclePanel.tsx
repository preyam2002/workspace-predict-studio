'use client';

import { Activity, Clock3, RefreshCcw } from 'lucide-react';
import type { IndexerOracle } from '@/lib/indexer';
import { isLiveOracleState } from '@/lib/predict-client';
import type { PythNavAnchor } from '@/lib/pyth';
import type { OracleState } from '@/lib/types';

function dollars(value: number) {
  return `$${(value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function usd(value: number, digits = 2) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function expiryText(expiryMs: number) {
  const delta = expiryMs - Date.now();
  if (delta <= 0) return 'expired';
  const minutes = Math.floor(delta / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function expiryOptionText(oracle: IndexerOracle) {
  const expiry = Number(oracle.expiry);
  return `${expiryText(expiry)} · ${new Date(expiry).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function OraclePanel({
  oracle,
  loading,
  error,
  pythAnchor,
  pythLoading,
  pythError,
  oracleOptions = [],
  selectedOracleId,
  onOracleChange,
  onRefresh,
}: {
  oracle?: OracleState;
  loading: boolean;
  error?: string;
  pythAnchor?: PythNavAnchor;
  pythLoading?: boolean;
  pythError?: string;
  oracleOptions?: IndexerOracle[];
  selectedOracleId?: string;
  onOracleChange?: (oracleId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="panel px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="metric-label">Live Oracle</div>
          <div className="metric-value mt-1 flex items-center gap-2 text-lg font-semibold">
            <Activity size={18} className="volt-text" />
            {oracle ? `${oracle.underlyingAsset} ${oracle.status}` : loading ? 'Loading Predict oracle' : 'Oracle unavailable'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {oracleOptions.length > 0 ? (
            <label className="surface grid gap-1 px-3 py-2 text-xs">
              <span className="metric-label">Expiry</span>
              <select
                className="bg-transparent outline-none metric-value"
                value={selectedOracleId ?? ''}
                onChange={(event) => onOracleChange?.(event.target.value)}
              >
                {oracleOptions.map((option) => (
                  <option key={option.oracle_id} value={option.oracle_id}>
                    {expiryOptionText(option)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="icon-button" onClick={onRefresh} type="button" title="Refresh oracle">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="danger-text mt-3 text-sm">{error}</div> : null}
      {pythError ? <div className="danger-text mt-3 text-sm">{pythError}</div> : null}
      {oracle && !isLiveOracleState(oracle) ? (
        <div className="surface warn-text mt-3 px-3 py-2 text-sm">
          This Predict oracle has expired. Choose another live expiry from the dropdown or refresh the oracle list before minting.
        </div>
      ) : null}
      {oracle ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Spot" value={dollars(oracle.spot)} />
          <Metric label="Forward" value={dollars(oracle.forward)} />
          <Metric
            label="Pyth BTC"
            value={pythAnchor ? `${usd(pythAnchor.price)}${pythAnchor.stale ? ' stale' : ''}` : pythLoading ? 'Loading' : '-'}
          />
          <Metric label="Pyth Conf" value={pythAnchor?.confidence === undefined ? '-' : `+/- ${usd(pythAnchor.confidence)}`} />
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
      <div className="metric-value mt-1 flex items-center gap-1 whitespace-nowrap text-sm">
        {icon}
        {value}
      </div>
    </div>
  );
}
