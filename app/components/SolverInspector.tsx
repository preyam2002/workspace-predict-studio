'use client';

import { Activity, Sigma } from 'lucide-react';
import { optimizeSparse } from '@/lib/optimizer';
import { USDC, type OracleState, type SparseTarget } from '@/lib/types';

function usd(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function SolverInspector({ oracle, target }: { oracle: OracleState; target: SparseTarget }) {
  const result = optimizeSparse(target, oracle.svi, oracle.forward);

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">NNOMP</div>
          <h2 className="text-base font-semibold">Sparse Solver</h2>
        </div>
        <div className="surface flex items-center gap-2 px-3 py-2 text-sm">
          <Sigma size={16} className="blue-text" />
          {result.best.legCount} legs
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {result.all.map((candidate) => (
          <div
            key={`${candidate.legCount}-${candidate.l2Error}-${candidate.premiumEst}`}
            className="surface grid grid-cols-4 items-center gap-2 px-3 py-2 text-sm"
          >
            <span className="metric-value">{candidate.legCount} legs</span>
            <span>{usd(candidate.premiumEst)}</span>
            <span>err {candidate.maxAbsError.toFixed(3)}</span>
            <span className={candidate === result.best ? 'good-text' : 'text-[#8c96a8]'}>
              {candidate === result.best ? 'best' : `${Math.round(candidate.premiumEst * USDC).toLocaleString()} q`}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-[#8c96a8]">
        <Activity size={14} />
        {target.gridStrikes.length} sampled cells
      </div>
    </section>
  );
}
