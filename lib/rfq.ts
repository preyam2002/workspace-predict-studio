import { bcs } from '@mysten/sui/bcs';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { blake2b } from '@noble/hashes/blake2b';
import { bytesToHex } from '@noble/hashes/utils';
import type { Leg } from './types';

export interface RfqQuote {
  structureHash: Uint8Array | number[];
  premium: bigint | number;
  maker: string;
  expiryMs: bigint | number;
  nonce: bigint | number;
}

export interface RfqRoute {
  route: 'book' | 'rfq';
  reason: string;
}

const QuoteBcs = bcs.struct('Quote', {
  structure_hash: bcs.vector(bcs.u8()),
  premium: bcs.u64(),
  maker: bcs.Address,
  expiry_ms: bcs.u64(),
  nonce: bcs.u64(),
});

const LegBcs = bcs.struct('Leg', {
  is_range: bcs.bool(),
  is_up: bcs.bool(),
  lower_strike: bcs.u64(),
  higher_strike: bcs.u64(),
  quantity: bcs.u64(),
});

export function canonicalQuoteBytes(quote: RfqQuote): Uint8Array {
  return QuoteBcs.serialize({
    structure_hash: Array.from(quote.structureHash),
    premium: BigInt(quote.premium),
    maker: quote.maker,
    expiry_ms: BigInt(quote.expiryMs),
    nonce: BigInt(quote.nonce),
  }).toBytes();
}

export function structureHash(legs: Leg[], shape: string): Uint8Array {
  const shapeBytes = bcs.string().serialize(shape).toBytes();
  const legsBytes = bcs
    .vector(LegBcs)
    .serialize(
      legs.map((leg) => ({
        is_range: leg.isRange,
        is_up: leg.isUp,
        lower_strike: BigInt(leg.lowerStrike),
        higher_strike: BigInt(leg.higherStrike),
        quantity: BigInt(leg.quantity),
      })),
    )
    .toBytes();
  const payload = new Uint8Array(shapeBytes.length + legsBytes.length);
  payload.set(shapeBytes);
  payload.set(legsBytes, shapeBytes.length);
  return blake2b(payload, { dkLen: 32 });
}

export function quoteDigestHex(quote: RfqQuote): string {
  return bytesToHex(blake2b(canonicalQuoteBytes(quote), { dkLen: 32 }));
}

export function makerAddressFromEd25519PublicKey(publicKey: Uint8Array | number[]): string {
  const key = Array.from(publicKey);
  return `0x${bytesToHex(blake2b(Uint8Array.from([0, ...key]), { dkLen: 32 }))}`;
}

export function routeForOrder(totalPremium: number, rfqThreshold: number): RfqRoute {
  if (totalPremium >= rfqThreshold) return { route: 'rfq', reason: 'above-threshold' };
  return { route: 'book', reason: 'below-threshold' };
}

export interface SignedQuote {
  quote: RfqQuote;
  publicKey: number[];
  signature: number[];
}

/**
 * Maker side: sign a canonical RFQ quote with an Ed25519 keypair. The maker address is
 * derived with Sui's own Ed25519 scheme (blake2b(0x00 || pubkey)) so the on-chain
 * `rfq::verify_and_mark` check `ed25519_address(public_key) == quote.maker` holds, and the
 * raw 64-byte signature verifies over `bcs::to_bytes(Quote)`.
 */
export async function signQuote(
  keypair: Ed25519Keypair,
  params: {
    structureHash: Uint8Array | number[];
    premium: bigint | number;
    expiryMs: bigint | number;
    nonce: bigint | number;
  },
): Promise<SignedQuote> {
  const publicKey = keypair.getPublicKey().toRawBytes();
  const quote: RfqQuote = {
    structureHash: Array.from(params.structureHash),
    premium: BigInt(params.premium),
    maker: makerAddressFromEd25519PublicKey(publicKey),
    expiryMs: BigInt(params.expiryMs),
    nonce: BigInt(params.nonce),
  };
  const signature = await keypair.sign(canonicalQuoteBytes(quote));
  return { quote, publicKey: Array.from(publicKey), signature: Array.from(signature) };
}

/** One-time setup: create and share a shared `RfqBook` for the given studio package. */
export function buildCreateRfqBookTx(pkg: string): Transaction {
  const tx = new Transaction();
  const book = tx.moveCall({ target: `${pkg}::rfq::new` });
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: [`${pkg}::rfq::RfqBook`],
    arguments: [book],
  });
  return tx;
}

// Taker side (verify signed quote + mint at the quoted premium in one PTB) lives on
// PredictClient.buildFillQuoteTx, which already owns the oracle/manager wiring the UI uses.
