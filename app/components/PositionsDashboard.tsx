'use client';

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { BadgeDollarSign, RefreshCcw } from 'lucide-react';
import { markLegs } from '@/lib/nav';
import { PredictClient, type StructuredPositionSummary } from '@/lib/predict-client';
import { USDC, type OracleState } from '@/lib/types';

function money(value: number): string {
  return `$${(value / USDC).toFixed(2)}`;
}

function pnlClass(value: number): string {
  if (value > 0) return 'good-text';
  if (value < 0) return 'danger-text';
  return 'text-[#8c96a8]';
}

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
          {positions.data.map((position: StructuredPositionSummary) => {
            const markOracle = oracle?.oracleId === position.oracleId ? oracle : undefined;
            const settleOracle =
              oracle && position.oracleId
                ? {
                    predictId: oracle.predictId,
                    managerId: position.managerId ?? oracle.managerId,
                    oracleId: position.oracleId,
                    dusdcType: oracle.dusdcType,
                  }
                : undefined;
            const mark = markOracle && !position.settled ? markLegs(position.legs, markOracle.svi, markOracle.forward) : 0;
            const pnl = mark - position.premiumPaid;
            return (
              <div className="surface flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm" key={position.objectId}>
                <div className="flex items-center gap-2">
                  <BadgeDollarSign size={16} className="good-text" />
                  <div>
                    <div className="metric-value">{position.shape || 'structured_position'}</div>
                    <div className="max-w-[260px] truncate text-xs text-[#8c96a8]">{position.objectId}</div>
                  </div>
                </div>
                <div className="grid min-w-[220px] grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-[#8c96a8]">Premium</span>
                  <span className="text-right">{money(position.premiumPaid)}</span>
                  <span className="text-[#8c96a8]">Mark</span>
                  <span className="text-right">{position.settled || !markOracle ? '-' : money(mark)}</span>
                  <span className="text-[#8c96a8]">P&L</span>
                  <span className={`text-right ${position.settled || !markOracle ? 'text-[#8c96a8]' : pnlClass(pnl)}`}>
                    {position.settled || !markOracle ? '-' : money(pnl)}
                  </span>
                  <span className="text-[#8c96a8]">Expiry</span>
                  <span className="text-right">{new Date(position.expiryMs).toLocaleString()}</span>
                </div>
                <button
                  className="icon-button"
                  disabled={!settleOracle?.managerId || !settleOracle.dusdcType || isPending || position.settled}
                  type="button"
                  onClick={() => {
                    if (!settleOracle?.managerId || !settleOracle.dusdcType) return;
                    mutate({ transaction: client.buildSettleTx(settleOracle, position.objectId) });
                  }}
                >
                  {position.settled ? 'Settled' : 'Settle'}
                </button>
              </div>
            );
          })}
        </div>
      ) : account && !positions.isLoading ? (
        <div className="mt-3 text-sm text-[#8c96a8]">No structured positions found for this package.</div>
      ) : null}
    </section>
  );
}
