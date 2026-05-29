import { describe, expect, it } from 'vitest';
import { decompose, decomposeFreeform } from './decompose';
import { USDC, type OracleState } from './types';

const oracle: OracleState = {
  predictId: '0x1',
  oracleId: '0x2',
  dbpPackage: '0xdbp',
  dusdcType: '0xd::dusdc::DUSDC',
  expiryMs: 1,
  nowMs: 0,
  spot: 70_000,
  forward: 70_000,
  status: 'active',
  underlyingAsset: 'BTC',
  svi: { a: 0.000001, b: 0.00001, rho: -0.3, m: 0, sigma: 0.001 },
  minStrike: 50_000,
  tickSize: 100,
  maxStrike: 90_000,
};

describe('decompose', () => {
  it('builds the core templates', () => {
    expect(decompose({ kind: 'digital_call', K: 70_050, qty: USDC }, oracle).legs).toEqual([
      { isRange: false, isUp: true, lowerStrike: 70_100, higherStrike: 0, quantity: USDC },
    ]);
    expect(decompose({ kind: 'strangle', kLo: 68_000, kHi: 72_000, qty: USDC }, oracle).legs).toEqual([
      { isRange: false, isUp: false, lowerStrike: 68_000, higherStrike: 0, quantity: USDC },
      { isRange: false, isUp: true, lowerStrike: 72_000, higherStrike: 0, quantity: USDC },
    ]);
    expect(decompose({ kind: 'peak', center: 70_000, width: 1_000, qty: USDC }, oracle).legs).toEqual([
      { isRange: true, isUp: false, lowerStrike: 69_000, higherStrike: 71_000, quantity: USDC },
    ]);
  });

  it('sizes capped payoff contracts in quote units', () => {
    expect(decompose({ kind: 'capped_bull', K: 70_000, maxLossUsd: 50, payoffUsd: 200 }, oracle).legs[0].quantity).toBe(
      200 * USDC,
    );
  });

  it('turns freeform regions into long-only legs', () => {
    const res = decomposeFreeform(
      {
        regions: [
          { lo: null, hi: 68_000, qty: USDC },
          { lo: 69_000, hi: 70_000, qty: 2 * USDC },
          { lo: 72_000, hi: null, qty: USDC },
        ],
      },
      oracle,
    );
    expect(res.legs).toEqual([
      { isRange: false, isUp: false, lowerStrike: 68_000, higherStrike: 0, quantity: USDC },
      { isRange: true, isUp: false, lowerStrike: 69_000, higherStrike: 70_000, quantity: 2 * USDC },
      { isRange: false, isUp: true, lowerStrike: 72_000, higherStrike: 0, quantity: USDC },
    ]);
  });
});
