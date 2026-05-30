'use client';

import { Landmark, RefreshCcw } from 'lucide-react';
import type { OracleState } from '@/lib/types';

export function VaultMarket({ oracle }: { oracle?: OracleState }) {
  const spot = oracle?.spot ?? 0;
  const vaults = [
    { name: 'Range Coupon', nav: 1.004, apr: 18.2, band: '25D / 25D' },
    { name: 'Bull Shark-Fin', nav: 0.992, apr: 24.7, band: spot ? `>${Math.round(spot).toLocaleString()}` : 'call wing' },
    { name: 'Twin-Win', nav: 1.011, apr: 21.3, band: 'two-tail' },
  ];

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Vaults</div>
          <h2 className="text-base font-semibold">STUDIO LP Market</h2>
        </div>
        <RefreshCcw size={16} className="blue-text" />
      </div>
      <div className="grid gap-2">
        {vaults.map((vault) => (
          <div key={vault.name} className="surface grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Landmark size={14} className="blue-text" />
                <span className="truncate font-medium">{vault.name}</span>
              </div>
              <div className="metric-label mt-1">{vault.band}</div>
            </div>
            <div className="text-right">
              <div className="metric-value">{vault.nav.toFixed(3)} NAV</div>
              <div className="good-text text-xs">{vault.apr.toFixed(1)}% APR</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
