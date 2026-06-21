'use client';

import { ConnectButton, useConnectWallet, useCurrentAccount, useWallets } from '@mysten/dapp-kit';
import { isGoogleWallet } from '@mysten/enoki';
import { WalletCards } from 'lucide-react';

export function WalletControls() {
  const account = useCurrentAccount();
  const wallets = useWallets();
  const { mutate, isPending } = useConnectWallet();
  const googleWallet = wallets.find(isGoogleWallet);

  return (
    <div className="flex items-center gap-2">
      <WalletCards size={18} className="volt-text" />
      {!account && googleWallet ? (
        <button className="icon-button" disabled={isPending} type="button" onClick={() => mutate({ wallet: googleWallet })}>
          Google
        </button>
      ) : null}
      <ConnectButton />
    </div>
  );
}
