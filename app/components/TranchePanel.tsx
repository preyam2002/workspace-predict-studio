'use client';

import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, SplitSquareHorizontal } from 'lucide-react';
import { TrancheClient, type TrancheIds } from '@/lib/tranche-client';

const STUDIO_PACKAGE = process.env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE ?? '0x0';
const TRANCHE_VAULT_ID = process.env.NEXT_PUBLIC_TRANCHE_VAULT_ID;
const VAULT_ID = process.env.NEXT_PUBLIC_VAULT_ID;
const ORACLE_ID = process.env.NEXT_PUBLIC_ORACLE_ID;
const SHARE_COIN_ID = process.env.NEXT_PUBLIC_STUDIO_LP_COIN_ID;
const PT_COIN_ID = process.env.NEXT_PUBLIC_PT_COIN_ID;
const YT_COIN_ID = process.env.NEXT_PUBLIC_YT_COIN_ID;
const FLOOR_BPS = Number(process.env.NEXT_PUBLIC_TRANCHE_FLOOR_BPS ?? 8_000);
const PT_COIN_TYPE = `${STUDIO_PACKAGE}::pt_yt::PT`;
const YT_COIN_TYPE = `${STUDIO_PACKAGE}::pt_yt::YT`;

function tokenAmount(balance?: string) {
  if (!balance) return '-';
  return (Number(balance) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function TranchePanel() {
  const account = useCurrentAccount();
  const sui = useSuiClient();
  const client = new TrancheClient(STUDIO_PACKAGE);
  const configured = Boolean(account && TRANCHE_VAULT_ID && STUDIO_PACKAGE !== '0x0');
  const ids: TrancheIds | undefined =
    configured && account ? { trancheVaultId: TRANCHE_VAULT_ID!, recipient: account.address } : undefined;
  const ptBalance = useQuery({
    queryKey: ['pt-balance', account?.address, PT_COIN_TYPE],
    queryFn: () => sui.getBalance({ owner: account!.address, coinType: PT_COIN_TYPE }),
    enabled: Boolean(configured),
    refetchInterval: 30_000,
  });
  const ytBalance = useQuery({
    queryKey: ['yt-balance', account?.address, YT_COIN_TYPE],
    queryFn: () => sui.getBalance({ owner: account!.address, coinType: YT_COIN_TYPE }),
    enabled: Boolean(configured),
    refetchInterval: 30_000,
  });
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const run = (kind: 'split' | 'merge' | 'settle' | 'redeem_pt' | 'redeem_yt') => {
    if (!ids) return;
    const transaction =
      kind === 'split'
        ? SHARE_COIN_ID && client.buildSplitTx(ids, SHARE_COIN_ID)
        : kind === 'merge'
          ? PT_COIN_ID && YT_COIN_ID && client.buildMergeTx(ids, PT_COIN_ID, YT_COIN_ID)
          : kind === 'settle'
            ? VAULT_ID && ORACLE_ID && client.buildSettleTx({ trancheVaultId: ids.trancheVaultId, vaultId: VAULT_ID, oracleId: ORACLE_ID })
            : kind === 'redeem_pt'
              ? PT_COIN_ID && client.buildRedeemPtTx(ids, PT_COIN_ID)
              : YT_COIN_ID && client.buildRedeemYtTx(ids, YT_COIN_ID);
    if (transaction) signAndExecute({ transaction });
  };

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="metric-label">Tranches</div>
          <h2 className="text-base font-semibold">PT / YT Split</h2>
        </div>
        <SplitSquareHorizontal size={16} className="blue-text" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="surface px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch size={14} className="good-text" />
            PT
          </div>
          <div className="metric-label mt-1">fixed floor claim</div>
          <div className="metric-value mt-2">{(FLOOR_BPS / 100).toFixed(0)}% floor</div>
          <div className="metric-label mt-1">{tokenAmount(ptBalance.data?.totalBalance)} PT</div>
        </div>
        <div className="surface px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch size={14} className="warn-text" />
            YT
          </div>
          <div className="metric-label mt-1">residual upside</div>
          <div className="metric-value mt-2">above floor</div>
          <div className="metric-label mt-1">{tokenAmount(ytBalance.data?.totalBalance)} YT</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button className="icon-button" disabled={isPending || !ids || !SHARE_COIN_ID} onClick={() => run('split')} type="button">
          Split
        </button>
        <button className="icon-button" disabled={isPending || !ids || !PT_COIN_ID || !YT_COIN_ID} onClick={() => run('merge')} type="button">
          Merge
        </button>
        <button className="icon-button" disabled={isPending || !ids || !VAULT_ID || !ORACLE_ID} onClick={() => run('settle')} type="button">
          Settle
        </button>
        <button className="icon-button" disabled={isPending || !ids || !PT_COIN_ID} onClick={() => run('redeem_pt')} type="button">
          Redeem PT
        </button>
        <button className="icon-button" disabled={isPending || !ids || !YT_COIN_ID} onClick={() => run('redeem_yt')} type="button">
          Redeem YT
        </button>
      </div>
    </section>
  );
}
