'use client';

import deploy from '@/deploy.json';
import { ExplorerLink } from './ExplorerLink';

export function LiveProofStrip() {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="metric-label">Verified on testnet</div>
          <h2 className="text-base font-semibold">Real mint, settle, and borrow proof</h2>
        </div>
      </div>
      <div className="grid gap-2 text-sm md:grid-cols-3">
        <ProofItem label="Minted note" value={deploy.sampleMintDigest} />
        <ProofItem label="Settled loss" value={deploy.sampleSettleDigest} />
        <ProofItem label="Settled win" value={deploy.vaultSettleDigest} />
      </div>
    </section>
  );
}

function ProofItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="surface min-w-0 px-3 py-2">
      <div className="metric-label">{label}</div>
      {value ? <ExplorerLink value={value} /> : <div className="metric-value muted-text">pending</div>}
    </div>
  );
}
