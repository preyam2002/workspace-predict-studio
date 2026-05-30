'use client';

import { GitBranch, SplitSquareHorizontal } from 'lucide-react';

export function TranchePanel() {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="metric-label">Tranches</div>
          <h2 className="text-base font-semibold">PT / YT Split</h2>
        </div>
        <SplitSquareHorizontal size={16} className="blue-text" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="surface px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch size={14} className="good-text" />
            PT
          </div>
          <div className="metric-label mt-1">fixed floor claim</div>
          <div className="metric-value mt-2">80% floor</div>
        </div>
        <div className="surface px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch size={14} className="warn-text" />
            YT
          </div>
          <div className="metric-label mt-1">residual upside</div>
          <div className="metric-value mt-2">variable</div>
        </div>
      </div>
    </section>
  );
}
