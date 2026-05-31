'use client';

import { useCurrentAccount, useSignAndExecuteTransaction, useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { toBase64 } from '@mysten/sui/utils';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { PredictClient } from '@/lib/predict-client';
import { USDC, type Leg, type OracleState } from '@/lib/types';

export function MintButton({
  client,
  oracle,
  legs,
  shape,
  maxLossBudget,
  disabled,
  onMinted,
}: {
  client: PredictClient;
  oracle: OracleState;
  legs: Leg[];
  shape: string;
  maxLossBudget: number;
  disabled?: boolean;
  onMinted: (digest: string) => void;
}) {
  const account = useCurrentAccount();
  const sui = useSuiClient();
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const { mutateAsync: signTransaction, isPending: isSigning } = useSignTransaction();
  const [gasless, setGasless] = useState(false);
  const [isGaslessPending, setIsGaslessPending] = useState(false);
  const pending = isPending || isSigning || isGaslessPending;
  const cannotMint = disabled || pending || legs.length === 0 || !oracle.managerId || !oracle.dusdcType || !account;

  async function mintGasless() {
    if (!account) return;
    setIsGaslessPending(true);
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
      onMinted(executed.digest);
    } finally {
      setIsGaslessPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <label className="surface flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span>Gasless</span>
        <input type="checkbox" checked={gasless} onChange={(event) => setGasless(event.target.checked)} />
      </label>
      <button
        className="icon-button primary-button w-full"
        disabled={cannotMint}
        type="button"
        title={!oracle.managerId || !oracle.dusdcType ? 'Set NEXT_PUBLIC_MANAGER_ID and NEXT_PUBLIC_DUSDC_TYPE after setup' : 'Mint structure'}
        onClick={() => {
          if (gasless) {
            void mintGasless();
            return;
          }
          mutate(
            { transaction: client.buildMintTx(oracle, legs, shape, maxLossBudget) },
            { onSuccess: (result) => onMinted(result.digest) },
          );
        }}
      >
        <Send size={16} />
        {pending ? 'Minting' : `Mint Max Loss $${(maxLossBudget / USDC).toFixed(2)}`}
      </button>
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
