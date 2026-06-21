import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseVaultSetupResult } from '../lib/deploy-utils';
import { applyScriptEnv } from '../lib/script-env';
import { VaultClient } from '../lib/vault-client';

applyScriptEnv();

if (!existsSync('./scripts/config.json')) {
  throw new Error('Missing scripts/config.json. Run `pnpm verify:first -- --write-config`, then fill dusdcType/dusdcCoinId if you want setup to fund the manager.');
}

const cfg = JSON.parse(readFileSync('./scripts/config.json', 'utf8')) as {
  dbp: string;
  managerId?: string;
  dusdcType?: string;
  dusdcCoinId?: string;
  managerFunded?: boolean;
  vaultId?: string;
  managerEscrowId?: string;
  keeperCapId?: string;
};

function keypairFromEnv() {
  const raw = process.env.SUI_KEYPAIR;
  if (!raw) throw new Error('SUI_KEYPAIR is required');
  if (raw.startsWith('suiprivkey')) return Ed25519Keypair.fromSecretKey(raw);
  const bytes = raw.includes(',') ? Uint8Array.from(raw.split(',').map(Number)) : Uint8Array.from(Buffer.from(raw, 'base64'));
  return Ed25519Keypair.fromSecretKey(bytes.length === 33 ? bytes.slice(1) : bytes);
}

function isObjectId(value: string | undefined): value is string {
  return Boolean(value?.startsWith('0x'));
}

const keypair = keypairFromEnv();
const client = new SuiJsonRpcClient({ url: process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
const sender = keypair.getPublicKey().toSuiAddress();
const deploy = existsSync('./deploy.json') ? JSON.parse(readFileSync('./deploy.json', 'utf8')) : {};

let managerId = (deploy.managerId as string | undefined) ?? cfg.managerId;
if (!managerId) {
  const createTx = new Transaction();
  createTx.moveCall({ target: `${cfg.dbp}::predict::create_manager`, arguments: [] });
  const created = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: createTx,
    options: { showEvents: true, showEffects: true },
  });

  if (created.effects?.status.status !== 'success') {
    throw new Error(`create_manager failed: ${created.effects?.status.error ?? 'unknown error'}`);
  }

  const createdEvent = created.events?.find((event: { type: string }) =>
    event.type.endsWith('::predict_manager::PredictManagerCreated'),
  );
  managerId = (createdEvent?.parsedJson as { manager_id?: string } | undefined)?.manager_id;
  if (!managerId) throw new Error('PredictManagerCreated event did not include manager_id');
}

if (cfg.dusdcType && isObjectId(cfg.dusdcCoinId) && !cfg.managerFunded) {
  const fundTx = new Transaction();
  fundTx.moveCall({
    target: `${cfg.dbp}::predict_manager::deposit`,
    typeArguments: [cfg.dusdcType],
    arguments: [fundTx.object(managerId), fundTx.object(cfg.dusdcCoinId)],
  });
  const funded = await client.signAndExecuteTransaction({ signer: keypair, transaction: fundTx, options: { showEffects: true } });
  if (funded.effects?.status.status !== 'success') {
    throw new Error(`manager deposit failed: ${funded.effects?.status.error ?? 'unknown error'}`);
  }
}

let vaultId = (deploy.vaultId as string | undefined) ?? cfg.vaultId;
let managerEscrowId = (deploy.managerEscrowId as string | undefined) ?? cfg.managerEscrowId;
let keeperCapId = (deploy.keeperCapId as string | undefined) ?? cfg.keeperCapId;
if ((!vaultId || !managerEscrowId) && deploy.packageId && deploy.shareFactoryId && cfg.dusdcType) {
  const vaultTx = new VaultClient(client, deploy.packageId).buildCreateVaultWithManagerEscrowTx({
    factoryId: deploy.shareFactoryId,
    quoteType: cfg.dusdcType,
    managerId,
    recipient: sender,
    minDeposit: Number(process.env.STUDIO_MIN_DEPOSIT ?? 1_000_000),
    performanceFeeBps: Number(process.env.STUDIO_PERF_FEE_BPS ?? 1_000),
    strategy: process.env.STUDIO_STRATEGY ?? 'fixed_coupon_range',
  });
  const vaultSetup = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: vaultTx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (vaultSetup.effects?.status.status !== 'success') {
    throw new Error(`vault setup failed: ${vaultSetup.effects?.status.error ?? 'unknown error'}`);
  }
  ({ vaultId, managerEscrowId, keeperCapId } = { ...{ vaultId, managerEscrowId, keeperCapId }, ...parseVaultSetupResult(vaultSetup) });
}

if (deploy.packageId && vaultId && cfg.dusdcType && !keeperCapId) {
  const keeperTx = new VaultClient(client, deploy.packageId).buildGrantKeeperTx(
    { vaultId, quoteType: cfg.dusdcType, recipient: sender },
    Number(process.env.STUDIO_KEEPER_MAX_BUDGET ?? 50_000_000),
  );
  const granted = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: keeperTx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (granted.effects?.status.status !== 'success') {
    throw new Error(`keeper grant failed: ${granted.effects?.status.error ?? 'unknown error'}`);
  }
  ({ keeperCapId } = { ...{ keeperCapId }, ...parseVaultSetupResult(granted) });
}

writeFileSync('./deploy.json', JSON.stringify({ ...deploy, managerId, vaultId, managerEscrowId, keeperCapId }, null, 2));
writeFileSync('./scripts/config.json', `${JSON.stringify({ ...cfg, managerId, vaultId, managerEscrowId, keeperCapId, sender }, null, 2)}\n`);
console.log('manager:', managerId);
if (vaultId) console.log('vault:', vaultId);
if (managerEscrowId) console.log('manager escrow:', managerEscrowId);
if (keeperCapId) console.log('keeper cap:', keeperCapId);
