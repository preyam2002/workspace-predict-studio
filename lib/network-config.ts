export type AppNetwork = 'testnet' | 'mainnet';

export interface MarginComposeConfig {
  supported: boolean;
  packageId?: string;
  composeTarget?: string;
  reason?: string;
}

export interface AppNetworkConfig {
  network: AppNetwork;
  rpcUrl?: string;
  predictStudioPackage: string;
  deepbookPredictPackage: string;
  managerId?: string;
  dusdcType?: string;
  vaultId?: string;
  oracleId?: string;
  cetusStudioPoolId?: string;
  collateralMarketId?: string;
  margin: MarginComposeConfig;
}

type Env = Record<string, string | undefined>;

function networkFromEnv(env: Env): AppNetwork {
  return env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

function scoped(env: Env, network: AppNetwork, key: string): string | undefined {
  return env[`NEXT_PUBLIC_${network.toUpperCase()}_${key}`] ?? env[`NEXT_PUBLIC_${key}`];
}

function marginConfig(env: Env): MarginComposeConfig {
  const packageId = env.NEXT_PUBLIC_MARGIN_PACKAGE;
  const composeTarget = env.NEXT_PUBLIC_MARGIN_COMPOSE_TARGET;
  if (packageId && composeTarget) return { supported: true, packageId, composeTarget };
  return {
    supported: false,
    reason: 'No verified deepbook_margin to Predict compose target is available in the current public SDK/contracts.',
  };
}

export function getAppNetworkConfig(env: Env = process.env): AppNetworkConfig {
  const network = networkFromEnv(env);
  return {
    network,
    rpcUrl: scoped(env, network, 'SUI_RPC_URL'),
    predictStudioPackage: scoped(env, network, 'PREDICT_STUDIO_PACKAGE') ?? '0x0',
    deepbookPredictPackage: scoped(env, network, 'DEEPBOOK_PREDICT_PACKAGE') ?? '0x0',
    managerId: scoped(env, network, 'MANAGER_ID'),
    dusdcType: scoped(env, network, 'DUSDC_TYPE'),
    vaultId: scoped(env, network, 'VAULT_ID'),
    oracleId: scoped(env, network, 'ORACLE_ID'),
    cetusStudioPoolId: scoped(env, network, 'CETUS_STUDIO_POOL_ID'),
    collateralMarketId: scoped(env, network, 'COLLATERAL_MARKET_ID'),
    margin: marginConfig(env),
  };
}
