'use client';

import { Boxes, CheckCircle2 } from 'lucide-react';
import { buildReplicationProof } from '@/lib/replication-proof';
import type { Leg, SparseTarget } from '@/lib/types';

export function ReplicationProofPanel({
  legs,
  premium,
  target,
  liveDigest,
}: {
  legs: Leg[];
  premium: number;
  target?: SparseTarget;
  liveDigest?: string;
}) {
  const proof = buildReplicationProof({ legs, premium, target, liveDigest });

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Proof</div>
          <h2 className="text-base font-semibold">Predict replication</h2>
        </div>
        <Boxes size={18} className="blue-text" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Badge label="Legs" value={`${proof.legCount}`} good={proof.onePtb} />
        <Badge label="PTB" value="one" good={proof.onePtb} />
        <Badge label="Max loss" value="premium" good={proof.maxLossEqualsPremium} />
      </div>
      <div className="mt-3 flex items-start gap-2 text-sm good-text">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>{proof.assertion}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {proof.rows.map((row, index) => (
          <div key={`${row.kind}-${row.condition}-${index}`} className="surface grid gap-1 px-3 py-2 text-sm md:grid-cols-[92px_1fr_auto] md:items-center">
            <span className="metric-label">{row.kind}</span>
            <span>{row.condition}</span>
            <span className="metric-value">{row.payout}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 surface break-all px-3 py-2 text-xs metric-label">Digest: {proof.digestLabel}</div>
    </section>
  );
}

function Badge({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="surface px-3 py-2">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${good ? 'good-text' : 'warn-text'}`}>{value}</div>
    </div>
  );
}
