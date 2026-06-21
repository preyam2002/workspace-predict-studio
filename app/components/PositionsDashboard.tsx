'use client';

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { BadgeDollarSign, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { markLegs } from '@/lib/nav';
import { PredictClient, type StructuredPositionSummary } from '@/lib/predict-client';
import { USDC, type OracleState } from '@/lib/types';
import { ExplorerLink } from './ExplorerLink';

function money(value: number): string {
  return `$${(value / USDC).toFixed(2)}`;
}

function pnlClass(value: number): string {
  if (value > 0) return 'good-text';
  if (value < 0) return 'danger-text';
  return 'muted-text';
}

export function PositionsDashboard({
  client,
  oracle,
  refreshKey = 0,
  lastMintDigest,
  lastMintPositionId,
}: {
  client: PredictClient;
  oracle?: OracleState;
  refreshKey?: number;
  lastMintDigest?: string;
  lastMintPositionId?: string;
}) {
  const account = useCurrentAccount();
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const positions = useQuery({
    queryKey: ['positions', account?.address],
    queryFn: () => client.listPositions(account!.address),
    enabled: Boolean(account),
  });
  const visiblePositions = useMemo(() => {
    return [...(positions.data ?? [])].sort((a, b) => {
      if (a.objectId === lastMintPositionId) return -1;
      if (b.objectId === lastMintPositionId) return 1;
      return b.expiryMs - a.expiryMs;
    });
  }, [lastMintPositionId, positions.data]);
  const lastMintListed = Boolean(lastMintPositionId && positions.data?.some((position) => position.objectId === lastMintPositionId));

  useEffect(() => {
    if (!account || refreshKey === 0) return;
    void positions.refetch();
  }, [account, positions.refetch, refreshKey]);

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
      {!account ? <div className="mt-3 text-sm muted-text">Connect a wallet to list owned positions.</div> : null}
      {account && lastMintDigest ? (
        <div className="surface mt-3 break-all px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="metric-label">Last signed mint</span>
            <span className={lastMintListed ? 'good-text' : 'muted-text'}>{lastMintListed ? 'Listed below' : 'Indexing receipt'}</span>
          </div>
          <div className="mt-1 muted-text">
            {lastMintPositionId ? <ExplorerLink value={lastMintPositionId} kind="object" /> : <ExplorerLink value={lastMintDigest} />}
          </div>
        </div>
      ) : null}
      {visiblePositions.length ? (
        <div className="mt-4 grid gap-2">
          {visiblePositions.map((position: StructuredPositionSummary) => {
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
            const isLastMint = position.objectId === lastMintPositionId;
            return (
              <div className="surface flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm" key={position.objectId}>
                <div className="flex items-center gap-2">
                  <BadgeDollarSign size={16} className="good-text" />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="metric-value">{position.shape || 'structured_position'}</span>
                      {isLastMint ? <span className="metric-label good-text">Last mint</span> : null}
                    </div>
                    <div className="max-w-[260px] truncate text-xs muted-text">
                      <ExplorerLink value={position.objectId} kind="object" />
                    </div>
                  </div>
                </div>
                <div className="grid min-w-[220px] grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="muted-text">Premium</span>
                  <span className="text-right">{money(position.premiumPaid)}</span>
                  <span className="muted-text">Mark</span>
                  <span className="text-right">{position.settled || !markOracle ? '-' : money(mark)}</span>
                  <span className="muted-text">P&L</span>
                  <span className={`text-right ${position.settled || !markOracle ? 'muted-text' : pnlClass(pnl)}`}>
                    {position.settled || !markOracle ? '-' : money(pnl)}
                  </span>
                  <span className="muted-text">Expiry</span>
                  <span className="text-right">{new Date(position.expiryMs).toLocaleString()}</span>
                </div>
                <button
                  className="icon-button"
                  disabled={!settleOracle?.managerId || !settleOracle.dusdcType || isPending || position.settled}
                  title={position.settled ? 'Already settled' : 'Settle this receipt; payout returns to the trading account balance.'}
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
        <div className="mt-3 text-sm muted-text">No structured positions found for this package.</div>
      ) : null}
    </section>
  );
}
