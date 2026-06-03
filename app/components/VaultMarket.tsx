'use client';

import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { Landmark, RefreshCcw } from 'lucide-react';
import seedVaults from '@/scripts/seed-vaults.json';
import { mockCetusSecondaryPrice, navDiscountPct, quoteConstantProductExit, type CetusSecondaryPrice } from '@/lib/cetus';
import type { OracleState } from '@/lib/types';
import { VaultClient, type VaultIds } from '@/lib/vault-client';

const STUDIO_PACKAGE = process.env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE ?? '0x0';
const VAULT_ID = process.env.NEXT_PUBLIC_VAULT_ID;
const DUSDC_TYPE = process.env.NEXT_PUBLIC_DUSDC_TYPE;
const DEPOSIT_COIN_ID = process.env.NEXT_PUBLIC_DUSDC_COIN_ID;
const SHARE_COIN_ID = process.env.NEXT_PUBLIC_STUDIO_LP_COIN_ID;
const RECEIPT_ID = process.env.NEXT_PUBLIC_PENDING_RECEIPT_ID;
const DEVINSPECT_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000000';
const SHARE_UNIT = 1_000_000;

async function loadSecondaryPrice(): Promise<CetusSecondaryPrice> {
  const response = await fetch('/api/cetus/secondary', { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? 'Cetus secondary price unavailable');
  }
  return response.json() as Promise<CetusSecondaryPrice>;
}

export function VaultMarket({ oracle }: { oracle?: OracleState }) {
  const account = useCurrentAccount();
  const sui = useSuiClient();
  const vaultClient = new VaultClient(sui, STUDIO_PACKAGE);
  const liveConfigured = Boolean(VAULT_ID && DUSDC_TYPE && STUDIO_PACKAGE !== '0x0');
  const secondaryQuery = useQuery({
    queryKey: ['cetus-secondary'],
    queryFn: loadSecondaryPrice,
    refetchInterval: 30_000,
  });
  const shareValueQuery = useQuery({
    queryKey: ['vault-share-value', STUDIO_PACKAGE, VAULT_ID, DUSDC_TYPE, oracle?.predictId, oracle?.oracleId, account?.address],
    queryFn: () =>
      oracle
        ? vaultClient.readShareValueMarked(
            VAULT_ID!,
            DUSDC_TYPE!,
            SHARE_UNIT,
            oracle.predictId,
            oracle.oracleId,
            account?.address ?? DEVINSPECT_SENDER,
          )
        : vaultClient.readShareValue(VAULT_ID!, DUSDC_TYPE!, SHARE_UNIT, account?.address ?? DEVINSPECT_SENDER),
    enabled: liveConfigured,
    refetchInterval: 30_000,
  });
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const secondary = secondaryQuery.data ?? mockCetusSecondaryPrice();
  const liveIds: VaultIds | undefined =
    liveConfigured && account
      ? { vaultId: VAULT_ID!, quoteType: DUSDC_TYPE!, recipient: account.address }
      : undefined;
  const rows = liveConfigured
    ? [
        {
          name: 'Live Strategy Vault',
          nav: shareValueQuery.data === undefined ? undefined : shareValueQuery.data / SHARE_UNIT,
          apr: undefined,
          band: oracle ? `${oracle.underlyingAsset} ${oracle.status}` : 'configured vault',
          secondary,
          live: true,
        },
      ]
    : seedVaults.vaults.slice(0, 3).map((vault, index) => ({
        name: vault.name,
        nav: vault.nav,
        apr: vault.apr,
        band: vault.strategy.replaceAll('_', ' '),
        secondary:
          index === 0
            ? secondary
            : {
                ...mockCetusSecondaryPrice(),
                price: quoteConstantProductExit(1_000, {
                  reserveIn: 80_000 + index * 15_000,
                  reserveOut: 79_000 + index * 16_000,
                  feeBps: 30,
                }).price,
              },
        live: false,
      }));

  const runVaultAction = (kind: 'deposit' | 'withdraw' | 'claim') => {
    if (!liveIds) return;
    const transaction =
      kind === 'deposit'
        ? DEPOSIT_COIN_ID && vaultClient.buildDepositTx(liveIds, DEPOSIT_COIN_ID)
        : kind === 'withdraw'
          ? SHARE_COIN_ID && vaultClient.buildWithdrawTx(liveIds, SHARE_COIN_ID)
          : RECEIPT_ID && vaultClient.buildClaimTx(liveIds, RECEIPT_ID);
    if (transaction) signAndExecute({ transaction });
  };

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Vaults</div>
          <h2 className="text-base font-semibold">STUDIO LP Market</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => {
            void secondaryQuery.refetch();
            void shareValueQuery.refetch();
          }}
          type="button"
          title="Refresh market"
        >
          <RefreshCcw size={16} />
        </button>
      </div>
      {secondaryQuery.error instanceof Error ? <div className="danger-text mb-3 text-sm">{secondaryQuery.error.message}</div> : null}
      <div className="grid gap-2">
        {rows.map((vault) => (
          <VaultRow
            key={vault.name}
            disabled={isPending}
            onDeposit={liveIds && DEPOSIT_COIN_ID ? () => runVaultAction('deposit') : undefined}
            onWithdraw={liveIds && SHARE_COIN_ID ? () => runVaultAction('withdraw') : undefined}
            onClaim={liveIds && RECEIPT_ID ? () => runVaultAction('claim') : undefined}
            vault={vault}
          />
        ))}
      </div>
    </section>
  );
}

function VaultRow({
  vault,
  disabled,
  onDeposit,
  onWithdraw,
  onClaim,
}: {
  vault: { name: string; nav?: number; apr?: number; band: string; secondary: CetusSecondaryPrice; live: boolean };
  disabled: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
  onClaim?: () => void;
}) {
  const discount = vault.nav === undefined ? undefined : navDiscountPct(vault.nav, vault.secondary.price);

  return (
    <div className="surface grid grid-cols-1 items-center gap-3 px-3 py-2 text-sm md:grid-cols-[1fr_auto_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Landmark size={14} className="blue-text" />
          <span className="truncate font-medium">{vault.name}</span>
        </div>
        <div className="metric-label mt-1">{vault.band}</div>
      </div>
      <div className="text-right">
        <div className="metric-value">{vault.nav === undefined ? 'Loading NAV' : `${vault.nav.toFixed(3)} NAV`}</div>
        <div className="good-text text-xs">{vault.apr === undefined ? (vault.live ? 'Live vault' : '-') : `${vault.apr.toFixed(1)}% APR`}</div>
        <div className={discount === undefined || discount >= 0 ? 'good-text text-xs' : 'warn-text text-xs'}>
          {vault.secondary.price.toFixed(3)} {vault.secondary.source} / {discount === undefined ? '-' : `${discount.toFixed(1)}%`}
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <button className="icon-button" disabled={disabled || !onDeposit} onClick={onDeposit} type="button">
          Deposit
        </button>
        <button className="icon-button" disabled={disabled || !onWithdraw} onClick={onWithdraw} type="button">
          Withdraw
        </button>
        <button className="icon-button" disabled={disabled || !onClaim} onClick={onClaim} type="button">
          Claim
        </button>
      </div>
    </div>
  );
}
