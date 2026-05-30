import { bcs } from '@mysten/sui/bcs';
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
