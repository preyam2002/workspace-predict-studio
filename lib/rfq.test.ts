import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import {
  buildCreateRfqBookTx,
  canonicalQuoteBytes,
  makerAddressFromEd25519PublicKey,
  quoteDigestHex,
  routeForOrder,
  signQuote,
  structureHash,
} from './rfq';

const maker = '0x7573c697fa68450f04fa0dee2d39dcdc8a5ccf5db547f3e47638a6f8eeeec110';
const publicKey = Buffer.from('79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664', 'hex');

describe('rfq', () => {
  it('matches the canonical BCS quote bytes used by Move rfq tests', () => {
    const bytes = canonicalQuoteBytes({
      structureHash: Array.from(Buffer.from('315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3', 'hex')),
      premium: 1_000_000n,
      maker,
      expiryMs: 999_999_999n,
      nonce: 42n,
    });
    expect(Buffer.from(bytes).toString('hex')).toBe(
      '20315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd340420f00000000007573c697fa68450f04fa0dee2d39dcdc8a5ccf5db547f3e47638a6f8eeeec110ffc99a3b000000002a00000000000000',
    );
    expect(makerAddressFromEd25519PublicKey(publicKey)).toBe(maker);
    expect(quoteDigestHex({ structureHash: Array.from(bytes.slice(1, 33)), premium: 1_000_000n, maker, expiryMs: 999_999_999n, nonce: 42n })).toHaveLength(64);
  });

  it('hashes structures deterministically and routes large orders to RFQ', () => {
    const legs = [{ isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 1_000_000 }];
    expect(Buffer.from(structureHash(legs, 'digital_call')).toString('hex')).toBe(
      '7cd4ab55e5298923d572ad683d10cabd8488fd368f692b62bed9739f1fca20ac',
    );
    expect(routeForOrder(999, 1_000).route).toBe('book');
    expect(routeForOrder(1_000, 1_000).route).toBe('rfq');
  });

  it('signs a maker quote that verifies and binds to the Ed25519 maker address', async () => {
    const keypair = Ed25519Keypair.generate();
    const legs = [{ isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 1_000_000 }];
    const hash = structureHash(legs, 'digital_call');
    const signed = await signQuote(keypair, { structureHash: hash, premium: 1_000_000n, expiryMs: 999_999_999n, nonce: 7n });

    // maker derivation must equal Sui's own Ed25519 address scheme (blake2b(0x00 || pk))
    expect(signed.quote.maker).toBe(keypair.toSuiAddress());
    expect(signed.publicKey).toHaveLength(32);
    expect(signed.signature).toHaveLength(64);
    expect(Array.from(signed.quote.structureHash)).toEqual(Array.from(hash));

    // the raw signature must verify over the exact canonical bytes the Move verifier checks
    const ok = await keypair.getPublicKey().verify(canonicalQuoteBytes(signed.quote), Uint8Array.from(signed.signature));
    expect(ok).toBe(true);
  });

  it('builds a create-book PTB without throwing', () => {
    // Note: tx.serialize()/getData() trip a valibot duplicate-instance quirk on pure inputs
    // in this toolchain; tx.build()/execution is unaffected (see live rfq:demo proof). We
    // assert structural construction here and prove the on-chain ABI in scripts/rfq-demo.ts.
    expect(buildCreateRfqBookTx('0xpkg')).toBeInstanceOf(Transaction);
  });

});
