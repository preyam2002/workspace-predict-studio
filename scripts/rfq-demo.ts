/**
 * RFQ live proof: an off-chain Ed25519-signed maker quote is verified on-chain and the
 * structured note is minted at the quoted premium in a single `rfq::fill_quote` PTB.
 *
 *   maker (off-chain)  --signs canonical BCS quote-->  taker (funded wallet)
 *   taker  --rfq::fill_quote(book, predict, manager, oracle, legs, quote, pk, sig)-->  StructuredPosition
 *
 * Dry run (default) prices the leg and prints the signed quote. Pass --execute to create
 * the RfqBook (once), fill the quote on testnet, re-verify on-chain, and record deploy.json.
 *
 * Run: pnpm rfq:demo            (dry run)
 *      pnpm rfq:demo -- --execute
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { snapStrike } from '../lib/decompose';
import { PredictClient, loadOracleState } from '../lib/predict-client';
import { buildCreateRfqBookTx, signQuote, structureHash } from '../lib/rfq';
import { applyScriptEnv } from '../lib/script-env';
import type { Leg } from '../lib/types';

applyScriptEnv();

const execute = process.argv.includes('--execute');

const studioPackage = process.env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE;
const managerId = process.env.NEXT_PUBLIC_MANAGER_ID;
const dusdcType = process.env.NEXT_PUBLIC_DUSDC_TYPE;
if (!studioPackage || !managerId || !dusdcType) {
  throw new Error('NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE, NEXT_PUBLIC_MANAGER_ID, and NEXT_PUBLIC_DUSDC_TYPE are required');
}

const rpcUrl = process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet');
const client = new SuiJsonRpcClient({ url: rpcUrl, network: 'testnet' });

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
    if (bytes[0] !== 0) continue;
    const candidate = Ed25519Keypair.fromSecretKey(bytes.slice(1));
    if (candidate.getPublicKey().toSuiAddress() === address) return candidate;
  }
  throw new Error(`No ed25519 key in ${keystorePath} for ${address}; set SUI_KEYPAIR instead`);
}

function createdId(changes: unknown[], typeRe: RegExp): string | undefined {
  const hit = (changes as { type?: string; objectType?: string; objectId?: string }[]).find(
    (c) => c.type === 'created' && typeof c.objectType === 'string' && typeRe.test(c.objectType),
  );
  return hit?.objectId;
}

// --verify: re-check the recorded RFQ fill digest on-chain (used by the readiness gate).
// Tx history is pruned by many testnet RPCs, so check a full-history node too.
if (process.argv.includes('--verify')) {
  const deployPath = './deploy.json';
  if (!existsSync(deployPath)) throw new Error('deploy.json missing — run pnpm rfq:demo -- --execute first');
  const rfq = (JSON.parse(readFileSync(deployPath, 'utf8')) as { rfq_demo?: Record<string, string> }).rfq_demo;
  if (!rfq?.fillDigest) {
    console.log('no rfq_demo block');
    process.exit(1);
  }
  const nodes = [...new Set([getJsonRpcFullnodeUrl('testnet'), process.env.SUI_RPC, process.env.SUI_RPC_URL].filter((v): v is string => Boolean(v)))];
  const clients = nodes.map((url) => new SuiJsonRpcClient({ url, network: 'testnet' }));
  let ok = false;
  for (const client of clients) {
    try {
      const tx = await client.getTransactionBlock({ digest: rfq.fillDigest, options: { showEffects: true } });
      if (tx.effects?.status?.status === 'success') { ok = true; break; }
    } catch {
      // pruned/unreachable on this node
    }
  }
  // Fallback for pruned tx history: the minted position object is durable proof of the fill.
  if (!ok && rfq.positionId) {
    for (const client of clients) {
      try {
        if ((await client.getObject({ id: rfq.positionId })).data) { ok = true; break; }
      } catch {
        // try next node
      }
    }
  }
  console.log(`rfqBook          ${rfq.rfqBookId}`);
  console.log(`fill digest      ${rfq.fillDigest}`);
  console.log(`position         ${rfq.positionId}`);
  console.log(`rfq_onchain_verified=${ok ? 'success' : 'failed'}`);
  process.exit(ok ? 0 : 1);
}

const sender = activeAddress();
const oracle = await loadOracleState(client, { managerId, dusdcType });
if (oracle.status !== 'active') {
  throw new Error(`Need an active oracle to mint; indexer returned status=${oracle.status}. Try again when a BTC oracle is active.`);
}

const predict = new PredictClient(client, studioPackage, oracle.dbpPackage);
const strike = snapStrike(oracle.forward, oracle);
const quantity = Number(process.env.RFQ_QUANTITY ?? 10_000);
const shape = process.env.RFQ_SHAPE ?? 'rfq_digital_call';
const legs: Leg[] = [{ isRange: false, isUp: true, lowerStrike: strike, higherStrike: 0, quantity }];

// The maker's quoted premium is the on-chain max-loss cap; it must cover the real minted
// ask cost (build_and_mint asserts premium_paid <= quoted premium). Price the leg live.
const ask = await predict.quoteLeg(oracle, legs[0], sender);
const premium = Math.ceil(ask * 1.02) + 1;

const structHash = structureHash(legs, shape);
const expiryMs = Date.now() + 3_600_000;
const nonce = Date.now();

// Maker is an off-chain market maker; a fresh keypair signs this quote (its public key and
// blake2b(0x00||pk) maker address are bound into the on-chain verification).
const makerKeypair = Ed25519Keypair.generate();
const signed = await signQuote(makerKeypair, { structureHash: structHash, premium, expiryMs, nonce });

console.log('RFQ live proof — signed-quote fill\n');
console.log(`sender (taker)   ${sender}`);
console.log(`maker            ${signed.quote.maker}`);
console.log(`oracle           ${oracle.oracleId} (${oracle.underlyingAsset} ${oracle.status})`);
console.log(`structure        ${shape}  up-digital @ strike ${strike}  qty ${quantity}`);
console.log(`live ask         ${ask}`);
console.log(`quoted premium   ${premium}  (max-loss cap)`);
console.log(`structure_hash   ${Buffer.from(structHash).toString('hex')}`);
console.log(`signature        ${Buffer.from(signed.signature).toString('hex').slice(0, 32)}… (64 bytes)`);

if (!execute) {
  console.log('\nDry run only. Re-run with --execute to create the book + fill the quote on testnet.');
  process.exit(0);
}

const keypair = keypairFor(sender);

let bookId = process.env.NEXT_PUBLIC_RFQ_BOOK_ID;
let bookCreateDigest = process.env.RFQ_BOOK_CREATE_DIGEST ?? 'reused';
if (!bookId) {
  const created = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: buildCreateRfqBookTx(studioPackage),
    options: { showEffects: true, showObjectChanges: true },
  });
  if (created.effects?.status?.status !== 'success') {
    throw new Error(`RfqBook creation failed: ${created.effects?.status?.error}`);
  }
  bookId = createdId(created.objectChanges ?? [], /::rfq::RfqBook$/);
  bookCreateDigest = created.digest;
  if (!bookId) throw new Error('Created RfqBook id not found in object changes');
  console.log(`\nbook created     ${bookCreateDigest}\nrfqBook          ${bookId}`);
} else {
  console.log(`\nrfqBook (reused) ${bookId}`);
}

const fillTx = predict.buildFillQuoteTx(oracle, bookId, legs, shape, signed.quote, signed.publicKey, signed.signature, sender);
const fillRes = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: fillTx,
  options: { showEffects: true, showObjectChanges: true },
});
const status = fillRes.effects?.status?.status;
if (status !== 'success') throw new Error(`fill_quote failed: ${fillRes.effects?.status?.error ?? status}`);
const positionId = createdId(fillRes.objectChanges ?? [], /::studio::StructuredPosition$/);

console.log(`\nfill digest      ${fillRes.digest}`);
console.log(`position         ${positionId ?? 'not-found-in-object-changes'}`);

// Re-verify against a full-history node (configured RPC may have pruned the new digest).
const verifier = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
const check = await verifier.getTransactionBlock({ digest: fillRes.digest, options: { showEffects: true } }).catch(() => undefined);
const verified = check?.effects?.status?.status === 'success';
console.log(`rfq_onchain_verified=${verified ? 'success' : 'failed'}`);

const deployPath = './deploy.json';
const deploy = existsSync(deployPath) ? (JSON.parse(readFileSync(deployPath, 'utf8')) as Record<string, unknown>) : {};
deploy.rfq_demo = {
  studioPackage,
  rfqBookId: bookId,
  bookCreateDigest,
  maker: signed.quote.maker,
  oracleId: oracle.oracleId,
  shape,
  strike: String(strike),
  quantity: String(quantity),
  quotedPremium: String(premium),
  liveAsk: String(ask),
  nonce: String(nonce),
  expiryMs: String(expiryMs),
  fillDigest: fillRes.digest,
  positionId,
};
writeFileSync(deployPath, `${JSON.stringify(deploy, null, 2)}\n`);
console.log('\nWrote rfq_demo block to deploy.json. Verify: sui client tx-block ' + fillRes.digest);
if (!verified) process.exitCode = 1;
