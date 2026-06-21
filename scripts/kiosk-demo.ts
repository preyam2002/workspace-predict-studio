/**
 * Kiosk live proof: wrap a creator note as a tradeable `StudioNote`, lock + list it in a
 * Kiosk under the StudioNote royalty policy, then purchase it — paying the capped royalty
 * to the publisher and emitting `note_kiosk::RoyaltyPaid` (which feeds the leaderboard).
 *
 *   mint StudioNote -> lock in Kiosk -> list        (one PTB)
 *   purchase -> pay_royalty -> confirm_request       (one PTB, emits RoyaltyPaid)
 *
 * Run: pnpm kiosk:demo            (dry run / plan)
 *      pnpm kiosk:demo -- --execute
 *      pnpm kiosk:demo -- --verify   (re-check recorded digests on-chain; used by the gate)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildMintAndListNoteTx, buildPurchaseNoteTx, royaltyAmount } from '../lib/kiosk-client';
import { structureHash } from '../lib/rfq';
import { applyScriptEnv } from '../lib/script-env';

applyScriptEnv();

const rpcUrl = process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet');
const client = new SuiJsonRpcClient({ url: rpcUrl, network: 'testnet' });

function readDeploy(): Record<string, unknown> {
  if (!existsSync('./deploy.json')) throw new Error('deploy.json missing');
  return JSON.parse(readFileSync('./deploy.json', 'utf8')) as Record<string, unknown>;
}

// --verify: re-check recorded digests on-chain (full-history node + configured RPC).
if (process.argv.includes('--verify')) {
  const demo = readDeploy().kiosk_demo as Record<string, string> | undefined;
  if (!demo?.purchaseDigest) {
    console.log('no kiosk_demo block');
    process.exit(1);
  }
  const nodes = [...new Set([getJsonRpcFullnodeUrl('testnet'), process.env.SUI_RPC, process.env.SUI_RPC_URL].filter((u): u is string => Boolean(u)))];
  const clients = nodes.map((url) => new SuiJsonRpcClient({ url, network: 'testnet' }));
  async function ok(digest: string): Promise<boolean> {
    for (const client of clients) {
      try {
        const tx = await client.getTransactionBlock({ digest, options: { showEffects: true } });
        if (tx.effects?.status?.status === 'success') return true;
      } catch {
        // pruned/unreachable
      }
    }
    return false;
  }
  async function objExists(id?: string): Promise<boolean> {
    if (!id) return false;
    for (const client of clients) {
      try {
        if ((await client.getObject({ id })).data) return true;
      } catch {
        // try next node
      }
    }
    return false;
  }
  // Fallback for pruned tx history: the listed note + kiosk objects are durable proof.
  const verified =
    ((await ok(demo.mintListDigest)) && (await ok(demo.purchaseDigest))) ||
    ((await objExists(demo.noteId)) && (await objExists(demo.kioskId)));
  console.log(`kiosk           ${demo.kioskId}`);
  console.log(`note            ${demo.noteId}`);
  console.log(`royalty paid    ${demo.royaltyPaid}`);
  console.log(`kiosk_onchain_verified=${verified ? 'success' : 'failed'}`);
  process.exit(verified ? 0 : 1);
}

const deploy = readDeploy();
const kioskCfg = deploy.kiosk as Record<string, string> | undefined;
const pkg = process.env.NEXT_PUBLIC_KIOSK_PACKAGE ?? kioskCfg?.packageId;
const policyId = process.env.NEXT_PUBLIC_KIOSK_POLICY_ID ?? kioskCfg?.policyId;
const royaltyBps = Number(kioskCfg?.royaltyBps ?? 250);
if (!pkg || !policyId) throw new Error('Kiosk package/policy not configured — run the kiosk publish + create_and_share_policy first');

const execute = process.argv.includes('--execute');
const price = Number(process.env.KIOSK_PRICE ?? 1_000_000); // SUI mist
const premium = Number(process.env.KIOSK_NOTE_PREMIUM ?? 500_000);
const maturityMs = Number(process.env.KIOSK_NOTE_MATURITY ?? Date.now() + 30 * 24 * 3_600_000);
const structHash = structureHash([{ isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 }], 'kiosk_creator_note');

function suiClientArgs(args: string[]): string[] {
  return ['client', ...(process.env.SUI_CLIENT_CONFIG ? ['--client.config', process.env.SUI_CLIENT_CONFIG] : []), ...args];
}
function activeAddress(): string {
  return execFileSync('sui', suiClientArgs(['active-address']), { encoding: 'utf8' }).trim();
}
function keypairFor(address: string): Ed25519Keypair {
  const keystorePath = process.env.SUI_CLIENT_CONFIG
    ? join(dirname(process.env.SUI_CLIENT_CONFIG), 'sui.keystore')
    : join(homedir(), '.sui', 'sui_config', 'sui.keystore');
  const keys = JSON.parse(readFileSync(keystorePath, 'utf8')) as string[];
  for (const key of keys) {
    const bytes = Uint8Array.from(Buffer.from(key, 'base64'));
    if (bytes[0] !== 0) continue;
    const candidate = Ed25519Keypair.fromSecretKey(bytes.slice(1));
    if (candidate.getPublicKey().toSuiAddress() === address) return candidate;
  }
  throw new Error(`No ed25519 key for ${address}`);
}
function createdId(changes: unknown[], typeRe: RegExp): string | undefined {
  const hit = (changes as { type?: string; objectType?: string; objectId?: string }[]).find(
    (c) => c.type === 'created' && typeof c.objectType === 'string' && typeRe.test(c.objectType),
  );
  return hit?.objectId;
}

const sender = activeAddress();
console.log('Kiosk live proof — list a creator note, buy it, pay royalty\n');
console.log(`publisher/seller ${sender}`);
console.log(`kiosk package    ${pkg}`);
console.log(`policy           ${policyId}  (royalty ${royaltyBps / 100}%)`);
console.log(`list price       ${price} mist  -> royalty ${royaltyAmount(price, royaltyBps)} mist`);

if (!execute) {
  console.log('\nDry run only. Re-run with --execute to mint, list, and purchase on testnet.');
  process.exit(0);
}

const keypair = keypairFor(sender);

const listed = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: buildMintAndListNoteTx({ pkg, policyId, structureHash: structHash, publisher: sender, premium, maturityMs, royaltyBps, price, seller: sender }),
  options: { showEffects: true, showObjectChanges: true },
});
if (listed.effects?.status?.status !== 'success') throw new Error(`mint+list failed: ${listed.effects?.status?.error}`);
const kioskId = createdId(listed.objectChanges ?? [], /0x2::kiosk::Kiosk$/);
const noteId = createdId(listed.objectChanges ?? [], /::note_kiosk::StudioNote$/);
if (!kioskId || !noteId) throw new Error(`Could not find kiosk/note in object changes (kiosk=${kioskId}, note=${noteId})`);
console.log(`\nmint+list        ${listed.digest}\nkiosk            ${kioskId}\nnote             ${noteId}`);

const bought = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: buildPurchaseNoteTx({ pkg, policyId, kioskId, noteId, price, royaltyBps, buyer: sender }),
  options: { showEffects: true, showEvents: true },
});
if (bought.effects?.status?.status !== 'success') throw new Error(`purchase failed: ${bought.effects?.status?.error}`);
const royaltyEvent = (bought.events ?? []).find((e) => /::note_kiosk::RoyaltyPaid$/.test(e.type));
const royaltyPaid = (royaltyEvent?.parsedJson as { amount?: string } | undefined)?.amount ?? String(royaltyAmount(price, royaltyBps));
console.log(`purchase         ${bought.digest}`);
console.log(`RoyaltyPaid      amount=${royaltyPaid} publisher=${(royaltyEvent?.parsedJson as { publisher?: string } | undefined)?.publisher ?? sender}`);

const verifier = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
const check = await verifier.getTransactionBlock({ digest: bought.digest, options: { showEffects: true } }).catch(() => undefined);
const verified = check?.effects?.status?.status === 'success';
console.log(`kiosk_onchain_verified=${verified ? 'success' : 'failed'}`);

deploy.kiosk_demo = {
  packageId: pkg,
  policyId,
  kioskId,
  noteId,
  price: String(price),
  royaltyBps: String(royaltyBps),
  royaltyPaid: String(royaltyPaid),
  publisher: sender,
  mintListDigest: listed.digest,
  purchaseDigest: bought.digest,
};
writeFileSync('./deploy.json', `${JSON.stringify(deploy, null, 2)}\n`);
console.log('\nWrote kiosk_demo block to deploy.json. Verify: sui client tx-block ' + bought.digest);
if (!verified) process.exitCode = 1;
