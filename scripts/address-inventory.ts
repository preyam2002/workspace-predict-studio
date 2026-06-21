import { execFileSync } from 'node:child_process';
import {
  IMPORTANT_ASSETS,
  formatAddressInventory,
  formatUnits,
  summarizeImportantBalances,
  type BalanceSummaryInput,
} from '../lib/address-inventory';
import { applyScriptEnv } from '../lib/script-env';

applyScriptEnv();

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

interface AddressBook {
  activeAddress?: string;
  addresses?: Array<[string, string]>;
}

interface CoinObject {
  coinObjectId: string;
  balance: string;
}

interface CoinPage {
  data: CoinObject[];
  nextCursor?: string | null;
  hasNextPage?: boolean;
}

const RPC_URL = process.env.SUI_RPC_URL ?? process.env.SUI_RPC ?? 'https://fullnode.testnet.sui.io:443';

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

function suiClientArgs(args: string[]): string[] {
  return ['client', ...(process.env.SUI_CLIENT_CONFIG ? ['--client.config', process.env.SUI_CLIENT_CONFIG] : []), ...args];
}

function addressBook(): AddressBook {
  return JSON.parse(execFileSync('sui', suiClientArgs(['addresses', '--json']), { encoding: 'utf8' })) as AddressBook;
}

async function allBalances(address: string): Promise<BalanceSummaryInput[]> {
  return rpc<BalanceSummaryInput[]>('suix_getAllBalances', [address]);
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

const book = addressBook();
const entries = book.addresses ?? [];
const summaries = await Promise.all(
  entries.map(async ([alias, address]) => summarizeImportantBalances({ alias, address, balances: await allBalances(address) })),
);

if (book.activeAddress) {
  const activeAlias = entries.find(([, address]) => address === book.activeAddress)?.[0] ?? 'unknown';
  console.log(`active\t${activeAlias}\t${book.activeAddress}`);
}
console.log(formatAddressInventory(summaries));

console.log('important_coin_objects\talias\tlabel\tcount\ttotal\tcoin_ids');
for (const [alias, address] of entries) {
  for (const [label, asset] of Object.entries(IMPORTANT_ASSETS)) {
    const coins = await coinObjects(address, asset.coinType);
    if (coins.length === 0) continue;
    const total = coins.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
    const ids = coins.map((coin) => `${coin.coinObjectId}:${coin.balance}`).join(',');
    console.log(['important_coin_objects', alias, label, coins.length.toString(), formatUnits(total, asset.decimals), ids].join('\t'));
  }
}
