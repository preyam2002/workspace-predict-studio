'use client';

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Store } from 'lucide-react';
import { useState } from 'react';
import { buildMintAndListNoteTx } from '@/lib/kiosk-client';
import { getAppNetworkConfig, isConfiguredId } from '@/lib/network-config';
import { structureHash } from '@/lib/rfq';
import type { Leg } from '@/lib/types';

const appConfig = getAppNetworkConfig();
const SUI_MIST = 1_000_000_000;

/**
 * Tokenize the current structure as a Kiosk-tradeable `StudioNote` and list it for sale under
 * the StudioNote royalty policy. Resales pay a capped royalty to the publisher on-chain
 * (note_kiosk::RoyaltyPaid), which surfaces on the creator leaderboard.
 */
export function KioskPanel({ legs, shape, premium }: { legs: Leg[]; shape: string; premium: number }) {
  const account = useCurrentAccount();
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [priceSui, setPriceSui] = useState('0.001');
  const [royaltyPct, setRoyaltyPct] = useState('2.5');
  const [digest, setDigest] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const pkg = appConfig.kioskPackage;
  const policyId = appConfig.kioskPolicyId;
  const configured = Boolean(isConfiguredId(pkg) && isConfiguredId(policyId));
  const royaltyBps = Math.round(Math.max(0, Math.min(10, Number(royaltyPct) || 0)) * 100);
  const priceMist = Math.round((Number(priceSui) || 0) * SUI_MIST);
  const canList = Boolean(account && configured && legs.length > 0 && priceMist > 0) && !isPending;

  function listNote() {
    if (!account || !pkg || !policyId) return;
    setError(undefined);
    setDigest(undefined);
    mutate(
      {
        transaction: buildMintAndListNoteTx({
          pkg,
          policyId,
          structureHash: structureHash(legs, shape),
          publisher: account.address,
          premium,
          maturityMs: Date.now() + 30 * 24 * 3_600_000,
          royaltyBps,
          price: priceMist,
          seller: account.address,
        }),
      },
      {
        onSuccess: (result) => setDigest(result.digest),
        onError: (err) => setError(err instanceof Error ? err.message : 'listing failed'),
      },
    );
  }

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Marketplace</div>
          <h2 className="text-base font-semibold">Tokenize &amp; list note</h2>
        </div>
        <Store size={16} className="blue-text" />
      </div>
      <p className="mb-3 text-xs muted-text leading-relaxed">
        Wrap this structure as a Kiosk-tradeable <code>StudioNote</code> and list it. Resales enforce a capped creator royalty
        on-chain via a real <code>TransferPolicy</code> and emit <code>RoyaltyPaid</code> to the leaderboard.
      </p>

      {!configured ? (
        <div className="surface px-3 py-2 text-sm muted-text">
          Set <code>NEXT_PUBLIC_KIOSK_PACKAGE</code> and <code>NEXT_PUBLIC_KIOSK_POLICY_ID</code> to enable listing.
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="surface grid gap-1 px-3 py-2 text-xs">
            <span className="metric-label">List price (SUI)</span>
            <input
              className="bg-transparent outline-none metric-value"
              inputMode="decimal"
              value={priceSui}
              onChange={(e) => setPriceSui(e.target.value)}
            />
          </label>
          <label className="surface grid gap-1 px-3 py-2 text-xs">
            <span className="metric-label">Royalty (%)</span>
            <input
              className="bg-transparent outline-none metric-value"
              inputMode="decimal"
              value={royaltyPct}
              onChange={(e) => setRoyaltyPct(e.target.value)}
            />
          </label>
        </div>
        <button className="icon-button primary-button w-full" disabled={!canList} type="button" onClick={listNote}>
          {isPending ? 'Listing' : 'Tokenize & list'}
        </button>
        {digest ? (
          <div className="surface break-all px-3 py-2 text-xs">
            <span className="metric-label mr-2">Listed</span>
            <span className="metric-value good-text">{digest}</span>
          </div>
        ) : null}
        {error ? <div className="danger-text text-xs">{error}</div> : null}
      </div>
    </section>
  );
}
