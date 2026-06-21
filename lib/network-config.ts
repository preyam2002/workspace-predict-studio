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
  /** Package that defines the live NoteCollateralMarket type; falls back to predictStudioPackage. */
  collateralPackageId: string;
  /** Package defining the kiosk-tradeable StudioNote + its Publisher-backed TransferPolicy. */
  kioskPackage?: string;
  kioskPolicyId?: string;
  margin: MarginComposeConfig;
}

type Env = Record<string, string | undefined>;
const ZERO_OBJECT_ID = /^0x0+$/i;

function publicEnv(): Env {
  return {
    NEXT_PUBLIC_SUI_NETWORK: process.env.NEXT_PUBLIC_SUI_NETWORK,
    NEXT_PUBLIC_SUI_RPC_URL: process.env.NEXT_PUBLIC_SUI_RPC_URL,
    NEXT_PUBLIC_TESTNET_SUI_RPC_URL: process.env.NEXT_PUBLIC_TESTNET_SUI_RPC_URL,
    NEXT_PUBLIC_MAINNET_SUI_RPC_URL: process.env.NEXT_PUBLIC_MAINNET_SUI_RPC_URL,
    NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE: process.env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE,
    NEXT_PUBLIC_TESTNET_PREDICT_STUDIO_PACKAGE: process.env.NEXT_PUBLIC_TESTNET_PREDICT_STUDIO_PACKAGE,
    NEXT_PUBLIC_MAINNET_PREDICT_STUDIO_PACKAGE: process.env.NEXT_PUBLIC_MAINNET_PREDICT_STUDIO_PACKAGE,
    NEXT_PUBLIC_DEEPBOOK_PREDICT_PACKAGE: process.env.NEXT_PUBLIC_DEEPBOOK_PREDICT_PACKAGE,
    NEXT_PUBLIC_TESTNET_DEEPBOOK_PREDICT_PACKAGE: process.env.NEXT_PUBLIC_TESTNET_DEEPBOOK_PREDICT_PACKAGE,
    NEXT_PUBLIC_MAINNET_DEEPBOOK_PREDICT_PACKAGE: process.env.NEXT_PUBLIC_MAINNET_DEEPBOOK_PREDICT_PACKAGE,
    NEXT_PUBLIC_MANAGER_ID: process.env.NEXT_PUBLIC_MANAGER_ID,
    NEXT_PUBLIC_TESTNET_MANAGER_ID: process.env.NEXT_PUBLIC_TESTNET_MANAGER_ID,
    NEXT_PUBLIC_MAINNET_MANAGER_ID: process.env.NEXT_PUBLIC_MAINNET_MANAGER_ID,
    NEXT_PUBLIC_DUSDC_TYPE: process.env.NEXT_PUBLIC_DUSDC_TYPE,
    NEXT_PUBLIC_TESTNET_DUSDC_TYPE: process.env.NEXT_PUBLIC_TESTNET_DUSDC_TYPE,
    NEXT_PUBLIC_MAINNET_DUSDC_TYPE: process.env.NEXT_PUBLIC_MAINNET_DUSDC_TYPE,
    NEXT_PUBLIC_VAULT_ID: process.env.NEXT_PUBLIC_VAULT_ID,
    NEXT_PUBLIC_TESTNET_VAULT_ID: process.env.NEXT_PUBLIC_TESTNET_VAULT_ID,
    NEXT_PUBLIC_MAINNET_VAULT_ID: process.env.NEXT_PUBLIC_MAINNET_VAULT_ID,
    NEXT_PUBLIC_ORACLE_ID: process.env.NEXT_PUBLIC_ORACLE_ID,
    NEXT_PUBLIC_TESTNET_ORACLE_ID: process.env.NEXT_PUBLIC_TESTNET_ORACLE_ID,
    NEXT_PUBLIC_MAINNET_ORACLE_ID: process.env.NEXT_PUBLIC_MAINNET_ORACLE_ID,
    NEXT_PUBLIC_CETUS_STUDIO_POOL_ID: process.env.NEXT_PUBLIC_CETUS_STUDIO_POOL_ID,
    NEXT_PUBLIC_TESTNET_CETUS_STUDIO_POOL_ID: process.env.NEXT_PUBLIC_TESTNET_CETUS_STUDIO_POOL_ID,
    NEXT_PUBLIC_MAINNET_CETUS_STUDIO_POOL_ID: process.env.NEXT_PUBLIC_MAINNET_CETUS_STUDIO_POOL_ID,
    NEXT_PUBLIC_COLLATERAL_MARKET_ID: process.env.NEXT_PUBLIC_COLLATERAL_MARKET_ID,
    NEXT_PUBLIC_TESTNET_COLLATERAL_MARKET_ID: process.env.NEXT_PUBLIC_TESTNET_COLLATERAL_MARKET_ID,
    NEXT_PUBLIC_MAINNET_COLLATERAL_MARKET_ID: process.env.NEXT_PUBLIC_MAINNET_COLLATERAL_MARKET_ID,
    NEXT_PUBLIC_COLLATERAL_PACKAGE: process.env.NEXT_PUBLIC_COLLATERAL_PACKAGE,
    NEXT_PUBLIC_TESTNET_COLLATERAL_PACKAGE: process.env.NEXT_PUBLIC_TESTNET_COLLATERAL_PACKAGE,
    NEXT_PUBLIC_MAINNET_COLLATERAL_PACKAGE: process.env.NEXT_PUBLIC_MAINNET_COLLATERAL_PACKAGE,
    NEXT_PUBLIC_KIOSK_PACKAGE: process.env.NEXT_PUBLIC_KIOSK_PACKAGE,
    NEXT_PUBLIC_TESTNET_KIOSK_PACKAGE: process.env.NEXT_PUBLIC_TESTNET_KIOSK_PACKAGE,
    NEXT_PUBLIC_MAINNET_KIOSK_PACKAGE: process.env.NEXT_PUBLIC_MAINNET_KIOSK_PACKAGE,
    NEXT_PUBLIC_KIOSK_POLICY_ID: process.env.NEXT_PUBLIC_KIOSK_POLICY_ID,
    NEXT_PUBLIC_TESTNET_KIOSK_POLICY_ID: process.env.NEXT_PUBLIC_TESTNET_KIOSK_POLICY_ID,
    NEXT_PUBLIC_MAINNET_KIOSK_POLICY_ID: process.env.NEXT_PUBLIC_MAINNET_KIOSK_POLICY_ID,
    NEXT_PUBLIC_MARGIN_PACKAGE: process.env.NEXT_PUBLIC_MARGIN_PACKAGE,
    NEXT_PUBLIC_MARGIN_COMPOSE_TARGET: process.env.NEXT_PUBLIC_MARGIN_COMPOSE_TARGET,
  };
}

function networkFromEnv(env: Env): AppNetwork {
  return env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

// Treat empty-string env values as unset: .env files ship blank placeholders
// (`NEXT_PUBLIC_X=`) that must not shadow scoped fallbacks or derived defaults.
function text(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

export function isConfiguredId(value: string | undefined): value is string {
  return Boolean(value && !ZERO_OBJECT_ID.test(value));
}

function scoped(env: Env, network: AppNetwork, key: string): string | undefined {
  return text(env[`NEXT_PUBLIC_${network.toUpperCase()}_${key}`]) ?? text(env[`NEXT_PUBLIC_${key}`]);
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

export function getAppNetworkConfig(env: Env = publicEnv()): AppNetworkConfig {
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
    collateralPackageId:
      scoped(env, network, 'COLLATERAL_PACKAGE') ?? scoped(env, network, 'PREDICT_STUDIO_PACKAGE') ?? '0x0',
    kioskPackage: scoped(env, network, 'KIOSK_PACKAGE'),
    kioskPolicyId: scoped(env, network, 'KIOSK_POLICY_ID'),
    margin: marginConfig(env),
  };
}
