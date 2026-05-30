import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (!existsSync('./scripts/config.json')) {
  throw new Error('Missing scripts/config.json. Run `pnpm verify:first -- --write-config`, then fill dusdcType/dusdcCoinId if you want setup to fund the manager.');
}

const cfg = JSON.parse(readFileSync('./scripts/config.json', 'utf8')) as {
  dbp: string;
  dusdcType?: string;
  dusdcCoinId?: string;
};

function keypairFromEnv() {
  const raw = process.env.SUI_KEYPAIR;
  if (!raw) throw new Error('SUI_KEYPAIR is required');
  if (raw.startsWith('suiprivkey')) return Ed25519Keypair.fromSecretKey(raw);
  const bytes = raw.includes(',') ? Uint8Array.from(raw.split(',').map(Number)) : Uint8Array.from(Buffer.from(raw, 'base64'));
  return Ed25519Keypair.fromSecretKey(bytes.length === 33 ? bytes.slice(1) : bytes);
}

const keypair = keypairFromEnv();
const client = new SuiJsonRpcClient({ url: process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });

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
const managerId = (createdEvent?.parsedJson as { manager_id?: string } | undefined)?.manager_id;
if (!managerId) throw new Error('PredictManagerCreated event did not include manager_id');

if (cfg.dusdcType && cfg.dusdcCoinId) {
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

const deploy = existsSync('./deploy.json') ? JSON.parse(readFileSync('./deploy.json', 'utf8')) : {};
writeFileSync('./deploy.json', JSON.stringify({ ...deploy, managerId }, null, 2));
writeFileSync('./scripts/config.json', `${JSON.stringify({ ...cfg, managerId, sender: keypair.getPublicKey().toSuiAddress() }, null, 2)}\n`);
console.log('manager:', managerId);
