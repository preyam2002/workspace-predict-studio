export interface SponsorConfig {
  sponsorUrl: string;
  network: 'testnet' | 'mainnet' | 'devnet' | 'localnet';
  appId?: string;
}

export interface SponsoredTransactionRequest {
  txBytes: string;
  sender: string;
  network: SponsorConfig['network'];
  appId?: string;
}

export interface SponsoredTransactionResponse {
  digest?: string;
  txBytes?: string;
  sponsoredTxBytes?: string;
}

export interface EnokiAuthProviders {
  google: { clientId: string };
}

export function enokiAuthProvidersFromEnv(
  env: Record<string, string | undefined> = process.env,
): EnokiAuthProviders | undefined {
  const googleClientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!googleClientId) return undefined;
  return { google: { clientId: googleClientId } };
}

export function sponsorConfigFromEnv(env: Record<string, string | undefined> = process.env): SponsorConfig | undefined {
  const sponsorUrl = env.NEXT_PUBLIC_ENOKI_SPONSOR_URL;
  if (!sponsorUrl) return undefined;
  return {
    sponsorUrl,
    network: (env.NEXT_PUBLIC_SUI_NETWORK as SponsorConfig['network'] | undefined) ?? 'testnet',
    appId: env.NEXT_PUBLIC_ENOKI_APP_ID,
  };
}

export function buildSponsoredTransactionRequest(
  txBytes: string,
  sender: string,
  config: SponsorConfig,
): SponsoredTransactionRequest {
  return { txBytes, sender, network: config.network, appId: config.appId };
}

export async function requestSponsoredTransaction(
  request: SponsoredTransactionRequest,
  config: SponsorConfig,
  fetcher: typeof fetch = fetch,
): Promise<SponsoredTransactionResponse> {
  const res = await fetcher(config.sponsorUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`sponsor request failed: ${res.status}`);
  return res.json() as Promise<SponsoredTransactionResponse>;
}
