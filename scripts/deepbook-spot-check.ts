import { execFileSync } from 'node:child_process';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import {
  DEEP_POOL_CREATION_FEE,
  DEFAULT_DEEPBOOK_TESTNET_PACKAGE_ID,
  DEFAULT_DEEPBOOK_TESTNET_DEEP_SUI_POOL_ID,
  DEFAULT_DEEPBOOK_TESTNET_DEEP_TYPE,
  bestDeepAddress,
  buildDeepForSuiQuoteTx,
  buildCreateDeepbookSpotPoolTx,
  deepbookPackageFromRegistryType,
  deepbookSpotPoolConfigFromEnv,
  deepbookSpotReadiness,
  formatDeepAmount,
  summarizeDeepBalance,
  type AddressDeepBalanceSummary,
  type BalanceSummaryInput,
} from '../lib/deepbook-spot-check';
import { applyScriptEnv } from '../lib/script-env';

applyScriptEnv();

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

const RPC_URL = process.env.SUI_RPC_URL ?? process.env.SUI_RPC ?? 'https://fullnode.testnet.sui.io:443';
const allAddresses = process.argv.includes('--all-addresses');
const dryRun = process.argv.includes('--dry-run');

interface CoinObject {
  coinObjectId: string;
  balance: string;
}

interface CoinPage {
  data: CoinObject[];
  nextCursor?: string | null;
  hasNextPage?: boolean;
}

interface ObjectResponse {
  data?: {
    type?: string;
  };
}

type DevInspectReturnValue = [number[], string];

function activeAddress(): string {
  const envAddress = process.env.SUI_ADDRESS;
  if (envAddress) return envAddress;
  return execFileSync('sui', suiClientArgs(['active-address']), { encoding: 'utf8' }).trim();
}

function suiClientArgs(args: string[]): string[] {
  return ['client', ...(process.env.SUI_CLIENT_CONFIG ? ['--client.config', process.env.SUI_CLIENT_CONFIG] : []), ...args];
}

function localAddresses(): string[] {
  const envAddress = process.env.SUI_ADDRESS;
  if (envAddress || !allAddresses) return [activeAddress()];
  const body = JSON.parse(execFileSync('sui', suiClientArgs(['addresses', '--json']), { encoding: 'utf8' })) as {
    activeAddress?: string;
    addresses?: Array<[string, string]>;
  };
  const addresses = body.addresses?.map(([, address]) => address) ?? [];
  return [...new Set(addresses.length > 0 ? addresses : [body.activeAddress ?? activeAddress()])];
}

async function allBalances(address: string): Promise<BalanceSummaryInput[]> {
  return rpc<BalanceSummaryInput[]>('suix_getAllBalances', [address]);
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as RpcResponse<T>;
  if (body.error) throw new Error(body.error.message ?? `${method} failed`);
  return body.result as T;
}

async function coinObjects(address: string, coinType: string): Promise<CoinObject[]> {
  const coins: CoinObject[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await rpc<CoinPage>('suix_getCoins', [address, coinType, cursor, 50]);
    coins.push(...page.data);
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return coins;
}

async function fundedDeepCoins(address: string, coinTypes: string[]): Promise<{ coinType: string; coinIds: string[] } | undefined> {
  for (const coinType of coinTypes) {
    const coins = await coinObjects(address, coinType);
    const total = coins.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
    if (total >= DEEP_POOL_CREATION_FEE) return { coinType, coinIds: coins.map((coin) => coin.coinObjectId) };
  }
  return undefined;
}

async function registryType(registryId: string): Promise<string | undefined> {
  const object = await rpc<ObjectResponse>('sui_getObject', [registryId, { showType: true }]);
  return object.data?.type;
}

function parseU64(value: DevInspectReturnValue | undefined): bigint | undefined {
  if (!value) return undefined;
  return value[0].reduce((sum, byte, index) => sum + (BigInt(byte) << (8n * BigInt(index))), 0n);
}

async function printDeepSuiQuotes(address: string, deepbookPackageId: string): Promise<void> {
  const client = new SuiJsonRpcClient({ url: RPC_URL, network: 'testnet' });
  for (const deep of [10n, 50n, 500n]) {
    const targetDeep = deep * 1_000_000n;
    const tx = buildDeepForSuiQuoteTx({
      deepbookPackageId,
      deepSuiPoolId: DEFAULT_DEEPBOOK_TESTNET_DEEP_SUI_POOL_ID,
      deepCoinType: DEFAULT_DEEPBOOK_TESTNET_DEEP_TYPE,
      targetDeep,
    });
    const result = await client.devInspectTransactionBlock({ sender: address, transactionBlock: tx });
    const values = (result.results?.[0]?.returnValues ?? []) as DevInspectReturnValue[];
    const baseOut = parseU64(values[0]) ?? 0n;
    const suiIn = parseU64(values[1]) ?? 0n;
    const deepFee = parseU64(values[2]) ?? 0n;
    const status = baseOut === 0n && suiIn === 0n ? 'no_liquidity' : 'quoted';
    console.log(`deep_sui_quote\t${deep.toString()} DEEP\t${status}\tbase_out=${baseOut}\tsui_in=${suiIn}\tdeep_fee=${deepFee}`);
  }
}

const addressSummaries: AddressDeepBalanceSummary[] = await Promise.all(
  localAddresses().map(async (address) => ({
    address,
    summary: summarizeDeepBalance(await allBalances(address)),
  })),
);
const best = bestDeepAddress(addressSummaries);
if (!best) throw new Error('No Sui addresses available for DeepBook Spot check');

const poolConfig = deepbookSpotPoolConfigFromEnv(process.env);
const status = deepbookSpotReadiness(best.summary, poolConfig.registryId);

console.log(`deepbook_spot_status\t${status}`);
console.log(`address\t${best.address}`);
console.log(`deep_balance\t${best.summary.totalBalance.toString()}\t${formatDeepAmount(best.summary.totalBalance)} DEEP`);
console.log(`required\t${DEEP_POOL_CREATION_FEE.toString()}\t${formatDeepAmount(DEEP_POOL_CREATION_FEE)} DEEP`);
console.log(`deep_coin_objects\t${best.summary.coinObjectCount}`);
console.log(`deep_coin_types\t${best.summary.coinTypes.length === 0 ? 'none' : best.summary.coinTypes.join(',')}`);
if (allAddresses) {
  console.log(`checked_addresses\t${addressSummaries.length}`);
  for (const item of addressSummaries) {
    console.log(
      `address_deep_balance\t${item.address}\t${item.summary.totalBalance.toString()}\t${formatDeepAmount(
        item.summary.totalBalance,
      )} DEEP\tobjects=${item.summary.coinObjectCount}`,
    );
  }
}
if (poolConfig.registryId) console.log(`registry_id\t${poolConfig.registryId}`);
if (poolConfig.deepbookPackageId) console.log(`deepbook_spot_package\t${poolConfig.deepbookPackageId}`);

if (status === 'blocked_missing_deep') {
  if (poolConfig.deepbookPackageId === DEFAULT_DEEPBOOK_TESTNET_PACKAGE_ID) {
    await printDeepSuiQuotes(best.address, poolConfig.deepbookPackageId);
  }
  console.log('next\tfund at least 500 DEEP before creating a DeepBook Spot secondary pool');
} else if (status === 'ready_needs_registry') {
  console.log('next\tset DEEPBOOK_REGISTRY_ID before dry-running STUDIO_LP/dUSDC pool creation');
} else if (dryRun) {
  if (!poolConfig.registryId) throw new Error('DEEPBOOK_REGISTRY_ID is required for DeepBook Spot dry-run');
  if (!poolConfig.baseCoinType) throw new Error('NEXT_PUBLIC_STUDIO_LP_TYPE or NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE is required');
  if (!poolConfig.quoteCoinType) throw new Error('NEXT_PUBLIC_DUSDC_TYPE is required for DeepBook Spot dry-run');

  const deepbookPackageId =
    poolConfig.deepbookPackageId ??
    deepbookPackageFromRegistryType(await registryType(poolConfig.registryId));
  if (!deepbookPackageId) throw new Error('DEEPBOOK_SPOT_PACKAGE_ID is required when registry type cannot derive it');

  const funded = await fundedDeepCoins(best.address, best.summary.coinTypes);
  if (!funded) throw new Error('No single DEEP coin type has enough balance for the 500 DEEP creation fee');

  const tx = buildCreateDeepbookSpotPoolTx({
    ...poolConfig,
    registryId: poolConfig.registryId,
    baseCoinType: poolConfig.baseCoinType,
    quoteCoinType: poolConfig.quoteCoinType,
    deepbookPackageId,
    deepCoinIds: funded.coinIds,
  });
  const client = new SuiJsonRpcClient({ url: RPC_URL, network: 'testnet' });
  const result = await client.devInspectTransactionBlock({ sender: best.address, transactionBlock: tx });
  const txStatus = result.effects?.status.status ?? 'unknown';
  console.log(`deepbook_spot_dry_run\t${txStatus === 'success' ? 'pass' : 'fail'}`);
  console.log(`deepbook_spot_dry_run_status\t${txStatus}`);
  console.log(`deepbook_spot_package\t${deepbookPackageId}`);
  console.log(`deepbook_spot_base\t${poolConfig.baseCoinType}`);
  console.log(`deepbook_spot_quote\t${poolConfig.quoteCoinType}`);
  console.log(`deepbook_spot_deep_coin_type\t${funded.coinType}`);
  if (result.effects?.status.error) console.log(`deepbook_spot_dry_run_error\t${result.effects.status.error}`);
  if (txStatus !== 'success') process.exitCode = 1;
} else {
  console.log('next\twallet has enough DEEP for a DeepBook Spot pool dry run');
}
