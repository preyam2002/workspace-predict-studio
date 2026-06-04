'use client';

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Banknote, Lock, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { CollateralClient } from '@/lib/collateral-client';
import { noteBorrowTerms } from '@/lib/note-collateral';
import type { Leg, OracleState } from '@/lib/types';

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
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [digest, setDigest] = useState<string>();
  const [error, setError] = useState<string>();

  // Indicative mark: a long note's redeemable bid sits at or below the premium paid.
  // The chain recomputes the true bid in open_note_position; we borrow a conservative
  // fraction so the live tx stays under the on-chain capacity.
  const terms = noteBorrowTerms({ markedValue: premium, maxPayout, ltvBps });
  const borrowAmount = Math.floor(terms.capacity / 2);
  const configured = Boolean(marketId && oracle.managerId && oracle.dusdcType && oracle.predictId);
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
      { onSuccess: (r) => setDigest(r.digest), onError: (e) => setError(e.message) },
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

      {!configured && (
        <div className="mt-2 warn-text text-xs">
          Set <code>NEXT_PUBLIC_COLLATERAL_MARKET_ID</code> (and manager/dUSDC) to enable live borrowing.
        </div>
      )}
      {digest && (
        <div className="mt-2 surface break-all px-3 py-2 text-xs good-text">Borrow digest: {digest}</div>
      )}
      {error && <div className="mt-2 warn-text break-all text-xs">{error}</div>}
    </section>
  );
}

function Cell({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="surface px-3 py-2">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${muted ? 'metric-label' : ''}`}>{value}</div>
    </div>
  );
}
