'use client';

import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Lock, ShieldCheck, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { CollateralClient, listNoteBorrows, type NoteBorrowSummary } from '@/lib/collateral-client';
import { isConfiguredId } from '@/lib/network-config';
import { noteBorrowTerms } from '@/lib/note-collateral';
import type { Leg, OracleState } from '@/lib/types';
import { ExplorerLink } from './ExplorerLink';

const fmt = (n: number) => `$${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

/**
 * Borrow-against-this-note: the prime-broker beat. Shows the chain-provable bounds
 * (floor 0 / live mark / ceiling = max_payout) and a conservative borrow capacity,
 * then mints the note and borrows against it in a single PTB. Honest by construction —
 * a repay-to-reclaim bridge, never leverage; max loss stays the premium paid.
 */
export function NoteCollateralPanel({
  pkg,
  oracle,
  legs,
  shape,
  premium,
  maxPayout,
  ltvBps = 5_000,
  marketId,
}: {
  pkg: string;
  oracle: OracleState;
  legs: Leg[];
  shape: string;
  premium: number;
  maxPayout: number;
  ltvBps?: number;
  marketId?: string;
}) {
  const account = useCurrentAccount();
  const sui = useSuiClient();
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [digest, setDigest] = useState<string>();
  const [error, setError] = useState<string>();

  const loans = useQuery({
    queryKey: ['note-borrows', account?.address, pkg, oracle.dusdcType],
    enabled: Boolean(account && isConfiguredId(pkg) && isConfiguredId(marketId) && oracle.dusdcType),
    queryFn: () => listNoteBorrows(sui, account!.address, pkg, oracle.dusdcType),
  });

  // Indicative mark: a long note's redeemable bid sits at or below the premium paid.
  // The chain recomputes the true bid in open_note_position; we borrow a conservative
  // fraction so the live tx stays under the on-chain capacity.
  const terms = noteBorrowTerms({ markedValue: premium, maxPayout, ltvBps });
  const borrowAmount = Math.floor(terms.capacity / 2);
  const missingConfig = collateralDisabledReason({
    pkg,
    marketId,
    managerId: oracle.managerId,
    dusdcType: oracle.dusdcType,
    predictId: oracle.predictId,
  });
  const configured = !missingConfig;
  const canBorrow = Boolean(configured && account && legs.length > 0 && borrowAmount > 0 && !isPending);

  function mintAndBorrow() {
    if (!account || !marketId || !oracle.dusdcType) return;
    setError(undefined);
    const client = new CollateralClient(pkg);
    const tx = client.buildMintAndBorrowTx({
      marketId,
      predictId: oracle.predictId,
      managerId: oracle.managerId ?? '',
      oracleId: oracle.oracleId,
      dusdcType: oracle.dusdcType,
      shape,
      legs,
      maxLossBudget: premium,
      borrowAmount,
      recipient: account.address,
    });
    mutate(
      { transaction: tx },
      {
        onSuccess: (r) => {
          setDigest(r.digest);
          loans.refetch();
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  async function repayAndReclaim(loan: NoteBorrowSummary) {
    if (!account || !oracle.dusdcType) return;
    setError(undefined);
    const paymentCoinIds: string[] = [];
    if (loan.debt > 0) {
      const coins = await sui.getCoins({ owner: account.address, coinType: oracle.dusdcType });
      const sorted = [...coins.data].sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)));
      let total = 0n;
      for (const coin of sorted) {
        paymentCoinIds.push(coin.coinObjectId);
        total += BigInt(coin.balance);
        if (total >= BigInt(loan.debt)) break;
      }
      if (total < BigInt(loan.debt)) {
        setError(`Repaying needs ${fmt(loan.debt)} dUSDC; wallet holds ${fmt(Number(total))}.`);
        return;
      }
    }
    const client = new CollateralClient(pkg);
    const tx = client.buildRepayAndReclaimTx({
      marketId: loan.marketId ?? marketId ?? '',
      dusdcType: oracle.dusdcType,
      positionId: loan.objectId,
      paymentCoinIds,
      debtAmount: loan.debt,
      recipient: account.address,
    });
    mutate(
      { transaction: tx },
      {
        onSuccess: (r) => {
          setDigest(r.digest);
          loans.refetch();
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Prime broker</div>
          <h2 className="text-base font-semibold">Borrow against this note</h2>
        </div>
        <Banknote size={18} className="blue-text" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <Cell label="Provable floor" value={fmt(terms.provableFloor)} muted />
        <Cell label="Indicative mark" value={fmt(terms.liveMark)} />
        <Cell label="Provable ceiling" value={fmt(terms.provableCeiling)} />
      </div>

      <div className="mt-3 surface flex items-center justify-between px-3 py-2 text-sm">
        <span className="metric-label">Borrow capacity · {(terms.ltvBps / 100).toFixed(0)}% LTV</span>
        <span className="metric-value good-text">{fmt(terms.capacity)}</span>
      </div>

      <div className="mt-3 flex items-start gap-2 text-xs metric-label">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>
          Capacity = LTV · min(live&nbsp;mark, max&nbsp;payout) — never above the chain-provable ceiling. Mint
          and borrow settle in one PTB; repay to reclaim the escrowed note. A defined-risk reclaim bridge, not
          leverage: max loss stays the premium paid.
        </span>
      </div>

      <button type="button" className="icon-button primary-button mt-3 w-full" disabled={!canBorrow} onClick={mintAndBorrow}>
        <Lock size={15} />
        {isPending ? 'Borrowing…' : `Mint + borrow ${fmt(borrowAmount)} in one transaction`}
      </button>

      {loans.data && loans.data.length > 0 && (
        <div className="mt-3">
          <div className="metric-label mb-2">Your note loans</div>
          {loans.data.map((loan) => (
            <div key={loan.objectId} className="surface mb-2 flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <div className="metric-value">{fmt(loan.debt)} debt</div>
                <div className="metric-label">locked value {fmt(loan.floorValue)}</div>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={isPending}
                onClick={() => repayAndReclaim(loan)}
              >
                <Undo2 size={14} />
                {loan.debt > 0 ? 'Repay & reclaim' : 'Reclaim note'}
              </button>
            </div>
          ))}
        </div>
      )}

      {missingConfig && (
        <div className="mt-2 surface px-3 py-2 text-xs warn-text leading-relaxed break-words">
          {missingConfig === 'missing-package' ? (
            <>
              Set <code className="break-all">NEXT_PUBLIC_COLLATERAL_PACKAGE</code> to the package that defines the live note market.
            </>
          ) : (
            <>
              Set <code className="break-all">NEXT_PUBLIC_COLLATERAL_MARKET_ID</code> and manager/dUSDC to enable live borrowing.
            </>
          )}
        </div>
      )}
      {digest && (
        <div className="mt-2 surface break-all px-3 py-2 text-xs good-text">
          <span className="metric-label mr-2">Last digest</span>
          <ExplorerLink value={digest} />
        </div>
      )}
      {error && <div className="mt-2 warn-text break-all text-xs">{error}</div>}
    </section>
  );
}

export function collateralDisabledReason({
  pkg,
  marketId,
  managerId,
  dusdcType,
  predictId,
}: {
  pkg: string;
  marketId?: string;
  managerId?: string;
  dusdcType?: string;
  predictId?: string;
}) {
  if (!isConfiguredId(pkg)) return 'missing-package';
  if (!isConfiguredId(marketId) || !isConfiguredId(managerId) || !dusdcType || !isConfiguredId(predictId)) return 'missing-market';
  return undefined;
}

function Cell({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="surface px-3 py-2">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${muted ? 'metric-label' : ''}`}>{value}</div>
    </div>
  );
}
