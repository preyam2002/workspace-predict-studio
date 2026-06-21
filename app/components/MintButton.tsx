'use client';

import { useCurrentAccount, useSignAndExecuteTransaction, useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { toBase64 } from '@mysten/sui/utils';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { mintedPositionIdFromTransaction, mintDisabledReason } from '@/lib/mint-state';
import { isLiveOracleState, PredictClient } from '@/lib/predict-client';
import { USDC, type Leg, type OracleState } from '@/lib/types';

export function MintButton({
  client,
  oracle,
  legs,
  shape,
  maxLossBudget,
  netMaxGain,
  accountAddress,
  managerOwner,
  disabled,
  defaultGasless = false,
  onMinted,
}: {
  client: PredictClient;
  oracle: OracleState;
  legs: Leg[];
  shape: string;
  maxLossBudget: number;
  netMaxGain?: number;
  accountAddress?: string;
  managerOwner?: string;
  disabled?: boolean;
  defaultGasless?: boolean;
  onMinted: (digest: string, positionId?: string) => void;
}) {
  const account = useCurrentAccount();
  const sui = useSuiClient();
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const { mutateAsync: signTransaction, isPending: isSigning } = useSignTransaction();
  const gaslessAvailable = Boolean(process.env.NEXT_PUBLIC_ENOKI_API_KEY);
  const [gasless, setGasless] = useState(defaultGasless && gaslessAvailable);
  const [isGaslessPending, setIsGaslessPending] = useState(false);
  const [isConfirmingMint, setIsConfirmingMint] = useState(false);
  const [mintError, setMintError] = useState<string>();
  const pending = isPending || isSigning || isGaslessPending || isConfirmingMint;
  const disabledReason = mintDisabledReason({
    explicitDisabled: disabled,
    pending,
    legsReady: legs.length > 0,
    managerId: oracle.managerId,
    dusdcType: oracle.dusdcType,
    accountConnected: Boolean(account),
    accountAddress,
    managerOwner,
    oracleLive: isLiveOracleState(oracle),
    netMaxGain,
  });
  const cannotMint = Boolean(disabledReason);

  async function finishMint(digest: string) {
    onMinted(digest);
    setIsConfirmingMint(true);
    try {
      const transaction = await sui.waitForTransaction({
        digest,
        options: { showEvents: true, showObjectChanges: true },
        timeout: 30_000,
        pollInterval: 1_000,
      });
      onMinted(digest, mintedPositionIdFromTransaction(transaction));
    } catch {
      onMinted(digest);
    } finally {
      setIsConfirmingMint(false);
    }
  }

  async function mintGasless() {
    if (!account) return;
    setIsGaslessPending(true);
    setMintError(undefined);
    try {
      const tx = client.buildMintTx(oracle, legs, shape, maxLossBudget);
      const transactionKindBytes = toBase64(await tx.build({ client: sui, onlyTransactionKind: true }));
      const sponsored = await postJson<{ digest: string; bytes: string }>('/api/sponsor', {
        transactionKindBytes,
        sender: account.address,
        network: process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet',
      });
      const { signature } = await signTransaction({ transaction: sponsored.bytes });
      const executed = await postJson<{ digest: string }>('/api/execute', {
        digest: sponsored.digest,
        signature,
      });
      await finishMint(executed.digest);
    } catch (error) {
      setMintError(
        error instanceof Error && error.message.includes('/api/sponsor')
          ? 'Gasless sponsor unavailable (Enoki keys not set). Turn off Gasless to mint with your wallet.'
          : error instanceof Error
            ? error.message
            : 'Gasless mint failed.',
      );
    } finally {
      setIsGaslessPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <label
        className="surface flex items-center justify-between gap-3 px-3 py-2 text-xs"
        title={gaslessAvailable ? 'Sponsor gas via Enoki zkLogin' : 'Set Enoki keys (NEXT_PUBLIC_ENOKI_API_KEY) to enable gasless minting'}
      >
        <span className={gaslessAvailable ? '' : 'muted-text'}>Gasless{gaslessAvailable ? '' : ' · unavailable'}</span>
        <input type="checkbox" checked={gasless} disabled={!gaslessAvailable} onChange={(event) => setGasless(event.target.checked)} />
      </label>
      <button
        className="icon-button primary-button w-full"
        disabled={cannotMint}
        type="button"
        title={disabledReason ?? 'Mint structure'}
        onClick={() => {
          setMintError(undefined);
          if (gasless) {
            void mintGasless();
            return;
          }
          mutate(
            { transaction: client.buildMintTx(oracle, legs, shape, maxLossBudget) },
            {
              onSuccess: (result) => void finishMint(result.digest),
              onError: (error) => setMintError(error instanceof Error ? error.message : 'Mint failed.'),
            },
          );
        }}
      >
        <Send size={16} />
        {isConfirmingMint
          ? 'Confirming position'
          : pending
            ? 'Minting'
            : disabledReason
              ? disabledReason
              : `Mint Max Loss $${(maxLossBudget / USDC).toFixed(2)}`}
      </button>
      {mintError ? <div className="text-xs danger-text">{mintError}</div> : null}
    </div>
  );
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
