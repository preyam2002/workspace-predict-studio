import { Transaction } from '@mysten/sui/transactions';

export const DEEP_POOL_CREATION_FEE = 500n * 1_000_000n;
export const DEFAULT_DEEPBOOK_SPOT_TICK_SIZE = 1;
export const DEFAULT_DEEPBOOK_SPOT_LOT_SIZE = 1000;
export const DEFAULT_DEEPBOOK_SPOT_MIN_SIZE = 1000;
export const DEFAULT_DEEPBOOK_TESTNET_PACKAGE_ID = '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c';
export const DEFAULT_DEEPBOOK_TESTNET_REGISTRY_ID = '0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1';
export const DEFAULT_DEEPBOOK_TESTNET_DEEP_TYPE =
  '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP';
export const DEFAULT_DEEPBOOK_TESTNET_DEEP_SUI_POOL_ID = '0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f';
export const SUI_COIN_TYPE = '0x2::sui::SUI';

export interface BalanceSummaryInput {
  coinType: string;
  coinObjectCount?: number;
  totalBalance: string;
}

export interface DeepBalanceSummary {
  ready: boolean;
  totalBalance: bigint;
  coinObjectCount: number;
  coinTypes: string[];
}

export interface AddressDeepBalanceSummary {
  address: string;
  summary: DeepBalanceSummary;
}

export type DeepbookSpotReadiness = 'blocked_missing_deep' | 'ready_needs_registry' | 'ready_to_dry_run';

type Env = Record<string, string | undefined>;

export interface DeepbookSpotPoolConfig {
  registryId: string | undefined;
  deepbookPackageId: string | undefined;
  baseCoinType: string | undefined;
  quoteCoinType: string | undefined;
  tickSize: number;
  lotSize: number;
  minSize: number;
}

export interface CreateDeepbookSpotPoolTxParams {
  registryId: string;
  baseCoinType: string;
  quoteCoinType: string;
  tickSize: number;
  lotSize: number;
  minSize: number;
  deepbookPackageId: string;
  deepCoinIds: string[];
}

export interface DeepForSuiQuoteTxParams {
  deepbookPackageId: string;
  deepSuiPoolId: string;
  deepCoinType: string;
  targetDeep: bigint;
}

export function isDeepCoinType(coinType: string): boolean {
  return coinType.endsWith('::deep::DEEP');
}

export function summarizeDeepBalance(balances: BalanceSummaryInput[]): DeepBalanceSummary {
  const deepBalances = balances.filter((balance) => isDeepCoinType(balance.coinType));
  const totalBalance = deepBalances.reduce((sum, balance) => sum + BigInt(balance.totalBalance), 0n);
  const coinObjectCount = deepBalances.reduce((sum, balance) => sum + (balance.coinObjectCount ?? 0), 0);
  const coinTypes = [...new Set(deepBalances.map((balance) => balance.coinType))];
  return {
    ready: totalBalance >= DEEP_POOL_CREATION_FEE,
    totalBalance,
    coinObjectCount,
    coinTypes,
  };
}

export function deepbookSpotReadiness(summary: DeepBalanceSummary, registryId: string | undefined): DeepbookSpotReadiness {
  if (!summary.ready) return 'blocked_missing_deep';
  if (!registryId) return 'ready_needs_registry';
  return 'ready_to_dry_run';
}

export function bestDeepAddress(addresses: AddressDeepBalanceSummary[]): AddressDeepBalanceSummary | undefined {
  return addresses.reduce<AddressDeepBalanceSummary | undefined>((best, current) => {
    if (!best || current.summary.totalBalance > best.summary.totalBalance) return current;
    return best;
  }, undefined);
}

export function formatDeepAmount(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  if (frac === 0n) return `${whole}`;
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

export function studioLpCoinType(packageId: string | undefined): string | undefined {
  return packageId ? `${packageId}::studio_lp::STUDIO_LP` : undefined;
}

export function deepbookPackageFromRegistryType(type: string | undefined): string | undefined {
  return type?.match(/^(0x[0-9a-fA-F]+)::registry::Registry$/)?.[1];
}

export function deepbookSpotPoolConfigFromEnv(env: Env): DeepbookSpotPoolConfig {
  const network = env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet';
  return {
    registryId:
      env.DEEPBOOK_REGISTRY_ID ??
      env.NEXT_PUBLIC_DEEPBOOK_REGISTRY_ID ??
      (network === 'testnet' ? DEFAULT_DEEPBOOK_TESTNET_REGISTRY_ID : undefined),
    deepbookPackageId:
      env.DEEPBOOK_SPOT_PACKAGE_ID ??
      env.NEXT_PUBLIC_DEEPBOOK_SPOT_PACKAGE_ID ??
      (network === 'testnet' ? DEFAULT_DEEPBOOK_TESTNET_PACKAGE_ID : undefined),
    baseCoinType: env.NEXT_PUBLIC_STUDIO_LP_TYPE ?? studioLpCoinType(env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE),
    quoteCoinType: env.NEXT_PUBLIC_DUSDC_TYPE,
    tickSize: Number(env.DEEPBOOK_SPOT_TICK_SIZE ?? DEFAULT_DEEPBOOK_SPOT_TICK_SIZE),
    lotSize: Number(env.DEEPBOOK_SPOT_LOT_SIZE ?? DEFAULT_DEEPBOOK_SPOT_LOT_SIZE),
    minSize: Number(env.DEEPBOOK_SPOT_MIN_SIZE ?? DEFAULT_DEEPBOOK_SPOT_MIN_SIZE),
  };
}

export function buildCreateDeepbookSpotPoolTx(params: CreateDeepbookSpotPoolTxParams): Transaction {
  if (params.deepCoinIds.length === 0) throw new Error('DeepBook Spot dry-run requires at least one DEEP coin object');

  const tx = new Transaction();
  const deepCoin = tx.object(params.deepCoinIds[0]);
  const mergeCoins = params.deepCoinIds.slice(1).map((id) => tx.object(id));
  if (mergeCoins.length > 0) tx.mergeCoins(deepCoin, mergeCoins);
  const [creationFee] = tx.splitCoins(deepCoin, [tx.pure.u64(Number(DEEP_POOL_CREATION_FEE))]);
  tx.moveCall({
    target: `${params.deepbookPackageId}::pool::create_permissionless_pool`,
    typeArguments: [params.baseCoinType, params.quoteCoinType],
    arguments: [
      tx.object(params.registryId),
      tx.pure.u64(params.tickSize),
      tx.pure.u64(params.lotSize),
      tx.pure.u64(params.minSize),
      creationFee,
    ],
  });
  return tx;
}

export function buildDeepForSuiQuoteTx(params: DeepForSuiQuoteTxParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${params.deepbookPackageId}::pool::get_quote_quantity_in`,
    typeArguments: [params.deepCoinType, SUI_COIN_TYPE],
    arguments: [tx.object(params.deepSuiPoolId), tx.pure.u64(Number(params.targetDeep)), tx.pure.bool(false), tx.object.clock()],
  });
  return tx;
}
