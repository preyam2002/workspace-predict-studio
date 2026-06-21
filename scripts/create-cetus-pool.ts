import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { buildCreateCetusPoolWithPriceTx, createCetusSdk, studioLpCoinType } from '../lib/cetus';
import { applyScriptEnv } from '../lib/script-env';
import { VaultClient } from '../lib/vault-client';

applyScriptEnv();

const execute = process.argv.includes('--execute');

const studioPackage = process.env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE;
const dusdcType = process.env.NEXT_PUBLIC_DUSDC_TYPE;
const vaultId = process.env.NEXT_PUBLIC_VAULT_ID;
if (!studioPackage || !dusdcType || !vaultId) {
  throw new Error('NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE, NEXT_PUBLIC_DUSDC_TYPE, and NEXT_PUBLIC_VAULT_ID are required');
}

const rpcUrl = process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet');
const client = new SuiJsonRpcClient({ url: rpcUrl, network: 'testnet' });
const lpType = process.env.NEXT_PUBLIC_STUDIO_LP_TYPE ?? studioLpCoinType(studioPackage);

function suiClientArgs(args: string[]): string[] {
  return ['client', ...(process.env.SUI_CLIENT_CONFIG ? ['--client.config', process.env.SUI_CLIENT_CONFIG] : []), ...args];
}

function activeAddress(): string {
  return execFileSync('sui', suiClientArgs(['active-address']), { encoding: 'utf8' }).trim();
}

function keypairFor(address: string): Ed25519Keypair {
  const raw = process.env.SUI_KEYPAIR;
  if (raw) {
    if (raw.startsWith('suiprivkey')) return Ed25519Keypair.fromSecretKey(raw);
    const bytes = raw.includes(',') ? Uint8Array.from(raw.split(',').map(Number)) : Uint8Array.from(Buffer.from(raw, 'base64'));
    return Ed25519Keypair.fromSecretKey(bytes.length === 33 ? bytes.slice(1) : bytes);
  }
  const keystorePath = process.env.SUI_CLIENT_CONFIG
    ? join(dirname(process.env.SUI_CLIENT_CONFIG), 'sui.keystore')
    : join(homedir(), '.sui', 'sui_config', 'sui.keystore');
  const keys = JSON.parse(readFileSync(keystorePath, 'utf8')) as string[];
  for (const key of keys) {
    const bytes = Uint8Array.from(Buffer.from(key, 'base64'));
    if (bytes[0] !== 0) continue; // ed25519 scheme flag
    const candidate = Ed25519Keypair.fromSecretKey(bytes.slice(1));
    if (candidate.getPublicKey().toSuiAddress() === address) return candidate;
  }
  throw new Error(`No ed25519 key in ${keystorePath} for ${address}; set SUI_KEYPAIR instead`);
}

const sender = activeAddress();
const sdk = await createCetusSdk('testnet', rpcUrl);
sdk.setSenderAddress?.(sender);

const existing = await sdk.Pool.getPoolByCoins?.([lpType, dusdcType]).catch(() => []);
const existingId = existing?.[0]
  ? ((existing[0] as { id?: string }).id ?? (existing[0] as { pool_address?: string }).pool_address)
  : undefined;
if (existingId) {
  console.log(`pool_exists\t${existingId}`);
  console.log(`env\tNEXT_PUBLIC_CETUS_STUDIO_POOL_ID=${existingId}`);
  process.exit(0);
}

// Anchor the initial pool price to the vault's live on-chain NAV per share. Prefer the
// oracle-marked NAV (cash + open strategy legs); fall back to cash-only share_value.
const vault = new VaultClient(client, studioPackage);
const oneShare = 1_000_000;
const localConfig = (() => {
  try {
    return JSON.parse(readFileSync('./scripts/config.json', 'utf8')) as { predictId?: string; oracleId?: string };
  } catch {
    return {};
  }
})();
const predictId = process.env.NEXT_PUBLIC_PREDICT_ID ?? localConfig.predictId;
const oracleId = process.env.NEXT_PUBLIC_ORACLE_ID ?? localConfig.oracleId;

let shareValue: number | undefined;
let navBasis = 'share_value_marked';
if (predictId && oracleId) {
  shareValue = await vault.readShareValueMarked(vaultId, dusdcType, oneShare, predictId, oracleId, sender).catch(() => undefined);
}
if (shareValue === undefined || shareValue <= 0) {
  navBasis = 'share_value';
  shareValue = await vault.readShareValue(vaultId, dusdcType, oneShare, sender);
}
if (!Number.isFinite(shareValue) || shareValue <= 0) {
  throw new Error(`Vault share value unavailable (${shareValue}); cannot anchor the pool price`);
}
const navPrice = shareValue / oneShare;
// Cetus canonical coin order for this pair is dUSDC (coin A) / STUDIO_LP (coin B) —
// the SDK silently swaps unsorted pairs without remapping amounts, so pass it sorted.
// Pool price is therefore LP-per-dUSDC; the app's reader handles the inversion.
const poolPrice = oneShare / shareValue;
// Fix the STUDIO_LP side in integer base units (6 decimals); the dUSDC side follows
// from the NAV price. Default 500 LP so plenty remains for the other demo flows.
const lpSide = process.env.CETUS_POOL_SEED_LP ?? '500000000';

console.log(`sender\t${sender}`);
console.log(`pair\t${dusdcType} / ${lpType}`);
console.log(`nav_basis\t${navBasis}`);
console.log(`nav_price\t${navPrice}`);
console.log(`pool_price_lp_per_dusdc\t${poolPrice}`);
console.log(`seed_lp\t${lpSide}`);

const tx = (await buildCreateCetusPoolWithPriceTx(
  {
    coinTypeA: dusdcType,
    coinTypeB: lpType,
    tickSpacing: 200,
    currentPrice: poolPrice.toString(),
    coinAmount: lpSide,
    fixAmountA: false,
    coinDecimalsA: 6,
    coinDecimalsB: 6,
    priceBaseCoin: 'coin_a',
    slippage: 0.05,
    fullRange: true,
  },
  sdk,
)) as Transaction;

if (!execute) {
  const inspect = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  const status = inspect.effects?.status?.status ?? 'unknown';
  const error = inspect.effects?.status?.error;
  console.log(`dry_run\t${status}${error ? `\t${error}` : ''}`);
  console.log('Re-run with --execute to create the pool.');
  process.exit(status === 'success' ? 0 : 1);
}

const keypair = keypairFor(sender);
const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showEffects: true, showObjectChanges: true },
});
const status = result.effects?.status?.status;
if (status !== 'success') throw new Error(`Pool creation failed: ${result.effects?.status?.error ?? status}`);

const poolChange = (result.objectChanges ?? []).find(
  (change) => change.type === 'created' && 'objectType' in change && /::pool::Pool</.test(change.objectType),
);
const poolId = poolChange && 'objectId' in poolChange ? poolChange.objectId : undefined;
console.log(`digest\t${result.digest}`);
console.log(`pool_id\t${poolId ?? 'not-found-in-object-changes'}`);
if (poolId) console.log(`env\tNEXT_PUBLIC_CETUS_STUDIO_POOL_ID=${poolId}`);
