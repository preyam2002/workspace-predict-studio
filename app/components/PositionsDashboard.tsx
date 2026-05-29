'use client';

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { BadgeDollarSign, RefreshCcw } from 'lucide-react';
import { PredictClient } from '@/lib/predict-client';
import type { OracleState } from '@/lib/types';

export function PositionsDashboard({ client, oracle }: { client: PredictClient; oracle?: OracleState }) {
  const account = useCurrentAccount();
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const positions = useQuery({
    queryKey: ['positions', account?.address],
    queryFn: () => client.listPositions(account!.address),
    enabled: Boolean(account),
  });

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Positions</div>
          <h2 className="text-base font-semibold">Structured Receipts</h2>
        </div>
        <button className="icon-button" type="button" onClick={() => positions.refetch()} title="Refresh positions">
          <RefreshCcw size={16} />
        </button>
      </div>
      {!account ? <div className="mt-3 text-sm text-[#8c96a8]">Connect a wallet to list owned positions.</div> : null}
      {positions.data?.length ? (
        <div className="mt-4 grid gap-2">
          {positions.data.map((position: { objectId?: string } | undefined) => (
            <div className="surface flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm" key={position?.objectId}>
              <div className="flex items-center gap-2">
                <BadgeDollarSign size={16} className="good-text" />
                <span className="metric-value">{position?.objectId}</span>
              </div>
              <button
                className="icon-button"
                disabled={!oracle || isPending}
                type="button"
                onClick={() => {
                  if (!oracle || !position?.objectId) return;
                  mutate({ transaction: client.buildSettleTx(oracle, position.objectId) });
                }}
              >
                Settle
              </button>
            </div>
          ))}
        </div>
      ) : account && !positions.isLoading ? (
        <div className="mt-3 text-sm text-[#8c96a8]">No structured positions found for this package.</div>
      ) : null}
    </section>
  );
}
