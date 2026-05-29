'use client';

import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Send } from 'lucide-react';
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
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const cannotMint = disabled || isPending || legs.length === 0 || !oracle.managerId || !oracle.dusdcType;

  return (
    <button
      className="icon-button primary-button w-full"
      disabled={cannotMint}
      type="button"
      title={!oracle.managerId || !oracle.dusdcType ? 'Set NEXT_PUBLIC_MANAGER_ID and NEXT_PUBLIC_DUSDC_TYPE after setup' : 'Mint structure'}
      onClick={() =>
        mutate(
          { transaction: client.buildMintTx(oracle, legs, shape, maxLossBudget) },
          { onSuccess: (result) => onMinted(result.digest) },
        )
      }
    >
      <Send size={16} />
      {isPending ? 'Minting' : `Mint Max Loss $${(maxLossBudget / USDC).toFixed(2)}`}
    </button>
  );
}
