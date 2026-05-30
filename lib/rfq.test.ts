import { describe, expect, it } from 'vitest';
import { canonicalQuoteBytes, quoteDigestHex, routeForOrder, structureHash } from './rfq';

describe('rfq', () => {
  it('matches the canonical BCS quote bytes used by Move rfq tests', () => {
    const bytes = canonicalQuoteBytes({
      structureHash: Array.from(Buffer.from('315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3', 'hex')),
      premium: 1_000_000n,
      maker: '0x00000000000000000000000000000000000000000000000000000000000000aa',
      expiryMs: 999_999_999n,
      nonce: 42n,
    });
    expect(Buffer.from(bytes).toString('hex')).toBe(
      '20315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd340420f000000000000000000000000000000000000000000000000000000000000000000000000aaffc99a3b000000002a00000000000000',
    );
    expect(quoteDigestHex({ structureHash: Array.from(bytes.slice(1, 33)), premium: 1_000_000n, maker: '0x00000000000000000000000000000000000000000000000000000000000000aa', expiryMs: 999_999_999n, nonce: 42n })).toHaveLength(64);
  });

  it('hashes structures deterministically and routes large orders to RFQ', () => {
    const legs = [{ isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 1_000_000 }];
    expect(Buffer.from(structureHash(legs, 'digital_call')).toString('hex')).toBe(
      '7cd4ab55e5298923d572ad683d10cabd8488fd368f692b62bed9739f1fca20ac',
    );
    expect(routeForOrder(999, 1_000).route).toBe('book');
    expect(routeForOrder(1_000, 1_000).route).toBe('rfq');
  });
});
