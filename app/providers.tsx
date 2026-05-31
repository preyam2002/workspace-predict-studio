'use client';

import { SuiClientProvider, useSuiClientContext, WalletProvider } from '@mysten/dapp-kit';
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { enokiAuthProvidersFromEnv } from '@/lib/enoki';
import '@mysten/dapp-kit/dist/index.css';

const networks = {
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' as const },
};

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <RegisterEnokiWallets />
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

function RegisterEnokiWallets() {
  const { client, network } = useSuiClientContext();

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
    const providers = enokiAuthProvidersFromEnv();
    if (!apiKey || !providers || !isEnokiNetwork(network)) return undefined;

    const { unregister } = registerEnokiWallets({
      apiKey,
      providers,
      client,
      network,
    });
    return unregister;
  }, [client, network]);

  return null;
}
