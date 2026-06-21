'use client';

import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { managerIdFromTransaction, type PredictClient } from '@/lib/predict-client';
import { USDC } from '@/lib/types';
import type { OracleState } from '@/lib/types';

function storageKey(accountAddress?: string) {
  return accountAddress ? `predict-studio:manager:${accountAddress.toLowerCase()}` : undefined;
}

export function useWalletManagerId(accountAddress?: string) {
  const key = storageKey(accountAddress);
  const [walletManagerId, setWalletManagerId] = useState<string | undefined>();

  useEffect(() => {
    if (!key || typeof window === 'undefined') {
      setWalletManagerId(undefined);
      return;
    }
    setWalletManagerId(window.localStorage.getItem(key) ?? undefined);
  }, [key]);

  const saveWalletManagerId = (managerId: string) => {
    setWalletManagerId(managerId);
    if (key && typeof window !== 'undefined') window.localStorage.setItem(key, managerId);
  };

  return [walletManagerId, saveWalletManagerId] as const;
}

export function TradingAccountPanel({
  accountAddress,
  client,
  oracle,
  managerOwner,
  depositAmount,
  onManagerReady,
}: {
  accountAddress?: string;
  client: PredictClient;
  oracle?: OracleState;
  managerOwner?: string;
  depositAmount?: number;
  onManagerReady: (managerId: string) => void;
}) {
  const sui = useSuiClient();
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [status, setStatus] = useState<string>();
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const ownsManager = Boolean(accountAddress && managerOwner && accountAddress.toLowerCase() === managerOwner.toLowerCase());
  const canDeposit = Boolean(accountAddress && oracle?.managerId && oracle.dusdcType && ownsManager && depositAmount && depositAmount > 0);
  const balanceQuery = useQuery({
    queryKey: ['manager-balance', oracle?.managerId, oracle?.dusdcType, accountAddress],
    queryFn: () => {
      if (!accountAddress || !oracle?.managerId || !oracle.dusdcType) throw new Error('Missing manager balance inputs');
      return client.getManagerBalance(oracle, accountAddress);
    },
    enabled: Boolean(accountAddress && oracle?.managerId && oracle.dusdcType && ownsManager),
    refetchInterval: 15_000,
  });
  const managerBalance = balanceQuery.data ?? 0;
  const canWithdraw = Boolean(accountAddress && oracle?.managerId && oracle.dusdcType && ownsManager && managerBalance > 0);
  const shortManager = useMemo(() => (oracle?.managerId ? `${oracle.managerId.slice(0, 6)}...${oracle.managerId.slice(-4)}` : undefined), [oracle?.managerId]);

  async function depositLargestCoin() {
    if (!accountAddress || !oracle?.managerId || !oracle.dusdcType || !depositAmount) return;
    setDepositing(true);
    setStatus(undefined);
    try {
      const coins = await sui.getCoins({ owner: accountAddress, coinType: oracle.dusdcType });
      const needed = BigInt(depositAmount);
      const coin = [...coins.data].sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance))).find((item) => BigInt(item.balance) >= needed);
      if (!coin) {
        setStatus('No dUSDC coin with enough balance found in this wallet.');
        return;
      }
      mutate(
        { transaction: client.buildDepositManagerTx(oracle, coin.coinObjectId, depositAmount) },
        {
          onSuccess: async (result) => {
            await sui.waitForTransaction({ digest: result.digest, timeout: 30_000, pollInterval: 1_000 });
            setStatus('dUSDC deposited into your trading account.');
            void balanceQuery.refetch();
          },
          onError: (error) => setStatus(error instanceof Error ? error.message : 'Deposit failed.'),
        },
      );
    } finally {
      setDepositing(false);
    }
  }

  async function withdrawManagerBalance() {
    if (!accountAddress || !oracle?.managerId || !oracle.dusdcType || managerBalance <= 0) return;
    setWithdrawing(true);
    setStatus(undefined);
    mutate(
      { transaction: client.buildWithdrawManagerTx(oracle, managerBalance, accountAddress) },
      {
        onSuccess: async (result) => {
          await sui.waitForTransaction({ digest: result.digest, timeout: 30_000, pollInterval: 1_000 });
          setStatus('dUSDC withdrawn to your wallet.');
          void balanceQuery.refetch();
        },
        onError: (error) => setStatus(error instanceof Error ? error.message : 'Withdraw failed.'),
        onSettled: () => setWithdrawing(false),
      },
    );
  }

  if (!accountAddress) return null;

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Trading account</div>
          <h2 className="text-base font-semibold">Wallet-owned manager</h2>
        </div>
        <Wallet size={18} className="blue-text" />
      </div>
      <div className="surface px-3 py-2 text-sm">
        <div className="metric-label">Manager</div>
        <div className="metric-value mt-1">{shortManager ?? 'Not created'}</div>
      </div>
      {oracle?.managerId && ownsManager ? (
        <div className="surface mt-2 flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="metric-label">Free dUSDC</span>
          <span className="metric-value good-text">
            {balanceQuery.isLoading ? 'Loading' : `$${(managerBalance / USDC).toLocaleString(undefined, { maximumFractionDigits: 6 })}`}
          </span>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        {!oracle?.managerId || !ownsManager ? (
          <button
            className="icon-button primary-button justify-center"
            type="button"
            disabled={isPending}
            onClick={() =>
              mutate(
                { transaction: client.buildCreateManagerTx() },
                {
                  onSuccess: async (result) => {
                    const tx = await sui.waitForTransaction({
                      digest: result.digest,
                      options: { showEvents: true },
                      timeout: 30_000,
                      pollInterval: 1_000,
                    });
                    const managerId = managerIdFromTransaction(tx);
                    if (managerId) {
                      onManagerReady(managerId);
                      setStatus('Trading account created. Deposit dUSDC before minting.');
                    } else {
                      setStatus('Manager created, but the event has not indexed yet.');
                    }
                  },
                  onError: (error) => setStatus(error instanceof Error ? error.message : 'Create manager failed.'),
                },
              )
            }
          >
            {isPending ? 'Creating manager' : 'Create trading account'}
          </button>
        ) : (
          <>
            <button className="icon-button justify-center" type="button" disabled={!canDeposit || depositing || isPending} onClick={() => void depositLargestCoin()}>
              {depositing ? 'Finding dUSDC' : 'Deposit quote premium'}
            </button>
            <button className="icon-button primary-button justify-center" type="button" disabled={!canWithdraw || withdrawing || isPending} onClick={() => void withdrawManagerBalance()}>
              {withdrawing ? 'Withdrawing' : 'Withdraw balance to wallet'}
            </button>
          </>
        )}
      </div>
      {status ? <div className="mt-3 text-xs muted-text">{status}</div> : null}
    </section>
  );
}
