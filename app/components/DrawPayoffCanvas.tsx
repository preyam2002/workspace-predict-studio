'use client';

import { PenLine } from 'lucide-react';
import type { OracleState, SparseTarget } from '@/lib/types';

const W = 320;
const H = 180;
const PAD = 18;
const MAX_PAYOFF = 3;

export function defaultDrawTarget(oracle: OracleState): SparseTarget {
  const center = Math.round(oracle.forward / oracle.tickSize) * oracle.tickSize;
  const gridStrikes: number[] = [];
  for (let i = -6; i <= 6; i += 1) {
    gridStrikes.push(Math.min(oracle.maxStrike, Math.max(oracle.minStrike, center + i * oracle.tickSize)));
  }
  const unique = [...new Set(gridStrikes)].sort((a, b) => a - b);
  return {
    gridStrikes: unique,
    g: unique.map((strike) => Math.max(0, Math.min(2, (strike - (center - 2 * oracle.tickSize)) / (2 * oracle.tickSize)))),
  };
}

function yFor(value: number) {
  return H - PAD - (Math.min(MAX_PAYOFF, Math.max(0, value)) / MAX_PAYOFF) * (H - 2 * PAD);
}

function points(target: SparseTarget) {
  const dx = (W - 2 * PAD) / Math.max(1, target.g.length - 1);
  return target.g.map((value, index) => `${PAD + index * dx},${yFor(value)}`).join(' ');
}

export function DrawPayoffCanvas({ target, onChange }: { target: SparseTarget; onChange: (target: SparseTarget) => void }) {
  const setFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    const y = ((event.clientY - rect.top) / rect.height) * H;
    const index = Math.min(target.g.length - 1, Math.max(0, Math.round(((x - PAD) / (W - 2 * PAD)) * (target.g.length - 1))));
    const value = Math.max(0, Math.min(MAX_PAYOFF, ((H - PAD - y) / (H - 2 * PAD)) * MAX_PAYOFF));
    const g = [...target.g];
    g[index] = Number(value.toFixed(3));
    onChange({ ...target, g });
  };

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="metric-label">Freeform</div>
          <h2 className="text-base font-semibold">Draw Payoff</h2>
        </div>
        <PenLine size={16} className="blue-text" />
      </div>
      <svg
        className="surface block w-full touch-none"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Freeform payoff curve"
        onPointerDown={setFromPointer}
        onPointerMove={(event) => {
          if (event.buttons === 1) setFromPointer(event);
        }}
      >
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(228,232,240,.22)" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(228,232,240,.22)" />
        {[1, 2].map((value) => (
          <line
            key={value}
            x1={PAD}
            y1={yFor(value)}
            x2={W - PAD}
            y2={yFor(value)}
            stroke="rgba(228,232,240,.10)"
            strokeDasharray="4 4"
          />
        ))}
        <polyline fill="none" stroke="var(--green)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" points={points(target)} />
        {target.g.map((value, index) => {
          const dx = (W - 2 * PAD) / Math.max(1, target.g.length - 1);
          return <circle key={`${index}-${value}`} cx={PAD + index * dx} cy={yFor(value)} r="4" fill="var(--green)" />;
        })}
      </svg>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Cells" value={String(target.g.length)} />
        <Metric label="Peak" value={`$${Math.max(...target.g).toFixed(2)}`} />
        <Metric label="Floor" value={`$${Math.min(...target.g).toFixed(2)}`} />
      </div>
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
