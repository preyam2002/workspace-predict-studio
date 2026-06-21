'use client';

import { Trophy } from 'lucide-react';
import type { PublisherRank } from '@/lib/creator';
import { USDC } from '@/lib/types';

function shortAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function usd(value: number) {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function CreatorLeaderboard({ ranks }: { ranks: PublisherRank[] }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Creators</div>
          <h2 className="text-base font-semibold">Publisher Volume</h2>
        </div>
        <Trophy size={16} className="blue-text" />
      </div>
      <div className="grid gap-2">
        {ranks.slice(0, 3).map((rank, index) => (
          <div key={rank.publisher} className="surface grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-sm">
            <div className="metric-value text-xs">#{index + 1}</div>
            <div className="min-w-0">
              <div className="truncate font-medium">{shortAddress(rank.publisher)}</div>
              <div className="metric-label mt-1">{rank.fills} fills</div>
            </div>
            <div className="metric-value text-right">{usd(rank.volume)}</div>
          </div>
        ))}
        {ranks.length === 0 ? <div className="surface px-3 py-2 text-sm muted-text">No publisher fills indexed.</div> : null}
      </div>
    </section>
  );
}
