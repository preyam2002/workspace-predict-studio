import { SuiJsonRpcClient, getJsonRpcFullnodeUrl, type SuiObjectData } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const INDEXER_BASE = 'https://predict-server.testnet.mystenlabs.com';
const CLOCK_ID = '0x6';
const ONE_USDC = 1_000_000;
const DEFAULT_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000001';

interface IndexerOracle {
  predict_id: string;
  oracle_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: string;
  settlement_price?: number;
}

interface LiveConfig {
  predictId: string;
  oracleId: string;
  dbp: string;
  managerId: string;
  dusdcType: string;
  dusdcCoinId: string;
  sender: string;
  expiry: number;
  minStrike: number;
  tickSize: number;
  forward?: number;
  atmStrike?: number;
  lastVerifiedAt?: string;
}

type MoveFields = Record<string, unknown>;

function decodeU64LE(bytes: number[] | Uint8Array): number {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let value = 0n;
  for (let i = 0; i < arr.length; i += 1) value += BigInt(arr[i]) << (8n * BigInt(i));
  return Number(value);
}

function fields(data: SuiObjectData): MoveFields {
  const content = data.content;
  if (!content || content.dataType !== 'moveObject') throw new Error('Oracle object did not return Move fields');
  return content.fields as MoveFields;
}

function nestedFields(value: unknown, label: string): MoveFields {
  const nested = (value as { fields?: MoveFields } | undefined)?.fields;
  if (!nested) throw new Error(`Oracle object missing ${label}`);
  return nested;
}

function numeric(value: unknown, label: string): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(num)) throw new Error(`Expected numeric ${label}`);
  return num;
}

function packageFromType(type?: string): string {
  const pkg = type?.split('::')[0];
  if (!pkg) throw new Error('Unable to infer package id from oracle object type');
  return pkg;
}

function readExistingConfig(): Partial<LiveConfig> {
  if (!existsSync('./scripts/config.json')) return {};
  return JSON.parse(readFileSync('./scripts/config.json', 'utf8')) as Partial<LiveConfig>;
}

async function readOracles(): Promise<IndexerOracle[]> {
  const res = await fetch(`${INDEXER_BASE}/oracles`);
  if (!res.ok) throw new Error(`/oracles returned ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('/oracles did not return an array');
  return body as IndexerOracle[];
}

async function main() {
  const writeConfig = process.argv.includes('--write-config');
  const client = new SuiJsonRpcClient({
    url: process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet'),
    network: 'testnet',
  });

  const oracles = await readOracles();
  const active = oracles.filter((oracle) => oracle.status === 'active');
  const oracle = active[0] ?? oracles[0];
  if (!oracle) throw new Error('No Predict oracles returned');

  const object = await client.getObject({
    id: oracle.oracle_id,
    options: { showContent: true, showType: true },
  });
  if (!object.data) throw new Error(`Oracle object not found: ${oracle.oracle_id}`);

  const objectFields = fields(object.data);
  const prices = nestedFields(objectFields.prices, 'prices');
  const forward = numeric(prices.forward, 'forward');
  const dbp = packageFromType(object.data.type ?? undefined);
  const minStrike = numeric(oracle.min_strike, 'min_strike');
  const tickSize = numeric(oracle.tick_size, 'tick_size');
  const atmStrike = minStrike + Math.max(1, Math.round((forward - minStrike) / tickSize)) * tickSize;
  const sender = process.env.SUI_SENDER ?? readExistingConfig().sender ?? DEFAULT_SENDER;

  const createManager = await client.getNormalizedMoveFunction({
    package: dbp,
    module: 'predict',
    function: 'create_manager',
  });
  const managerStruct = await client.getNormalizedMoveStruct({
    package: dbp,
    module: 'predict_manager',
    struct: 'PredictManager',
  });
  const managerAbilities = JSON.stringify(managerStruct.abilities).toLowerCase();

  const tx = new Transaction();
  const key = tx.moveCall({
    target: `${dbp}::market_key::up`,
    arguments: [tx.pure.id(oracle.oracle_id), tx.pure.u64(oracle.expiry), tx.pure.u64(atmStrike)],
  });
  tx.moveCall({
    target: `${dbp}::predict::get_trade_amounts`,
    arguments: [tx.object(oracle.predict_id), tx.object(oracle.oracle_id), key, tx.pure.u64(ONE_USDC), tx.object(CLOCK_ID)],
  });
  const quote = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  const status = quote.effects?.status.status ?? 'unknown';
  if (status !== 'success') throw new Error(`devInspect quote failed: ${quote.effects?.status.error ?? status}`);
  const returnValues = quote.results?.at(-1)?.returnValues;
  const askBytes = returnValues?.[0]?.[0];
  const bidBytes = returnValues?.[1]?.[0];
  if (!askBytes || !bidBytes) throw new Error('devInspect quote did not return two u64 values');
  const ask = decodeU64LE(askBytes);
  const bid = decodeU64LE(bidBytes);

  console.log(`oracles\tok\tcount=${oracles.length}\tactive=${active.length}`);
  console.log(`oracle\t${oracle.oracle_id}\tstatus=${oracle.status}\tasset=${oracle.underlying_asset}\texpiry=${oracle.expiry}`);
  console.log(`predict\t${oracle.predict_id}`);
  console.log(`dbp\t${dbp}`);
  console.log(`scale\tforward=${forward}\tminStrike=${minStrike}\ttickSize=${tickSize}\tatmStrike=${atmStrike}`);
  console.log(`create_manager\tok\tvisibility=${createManager.visibility}`);
  console.log(`predict_manager_abilities\t${managerAbilities}`);
  console.log(`devinspect_quote\tok\task=${ask}\tbid=${bid}\tsender=${sender}`);

  if (writeConfig) {
    const existing = readExistingConfig();
    const config: LiveConfig = {
      predictId: oracle.predict_id,
      oracleId: oracle.oracle_id,
      dbp,
      managerId: existing.managerId ?? 'replace-after-running-pnpm-setup',
      dusdcType: existing.dusdcType ?? process.env.NEXT_PUBLIC_DUSDC_TYPE ?? 'replace-with-dUSDC-coin-type',
      dusdcCoinId: existing.dusdcCoinId ?? 'replace-with-dUSDC-coin-object-id',
      sender,
      expiry: oracle.expiry,
      minStrike,
      tickSize,
      forward,
      atmStrike,
      lastVerifiedAt: new Date().toISOString(),
    };
    writeFileSync('./scripts/config.json', `${JSON.stringify(config, null, 2)}\n`);
    console.log('wrote\tscripts/config.json');
  }

  if (!managerAbilities.includes('store')) {
    console.log('vault_manager_gate\tdirect_vault_owned_blocked\tPredictManager lacks store; use ManagerEscrow + fund_manager_from_idle + roll_into_strategy');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
