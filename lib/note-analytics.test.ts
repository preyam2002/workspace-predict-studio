import { describe, expect, it } from 'vitest';
import { noteAnalytics } from './note-analytics';
import type { Leg, OracleState } from './types';

const oracle: OracleState = {
  predictId: '0x1',
  oracleId: '0x2',
  dbpPackage: '0xdbp',
  dusdcType: '0xd::dusdc::DUSDC',
  expiryMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
  nowMs: Date.now(),
  spot: 100,
  forward: 100,
  status: 'active',
  underlyingAsset: 'BTC',
  svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 },
  minStrike: 70,
  tickSize: 5,
  maxStrike: 130,
};

describe('note analytics', () => {
  it('aggregates greeks and payoff stats for a note', () => {
    const legs: Leg[] = [
      { isRange: true, isUp: false, lowerStrike: 90, higherStrike: 110, quantity: 1_000_000 },
      { isRange: false, isUp: true, lowerStrike: 115, higherStrike: 0, quantity: 500_000 },
    ];

    const analytics = noteAnalytics({ legs, premium: 320_000, oracle });

    expect(analytics.greeks.mark).toBeGreaterThan(0);
    expect(Object.values(analytics.greeks).every(Number.isFinite)).toBe(true);
    expect(analytics.payoff.maxLoss).toBeLessThanOrEqual(320_000);
    expect(analytics.payoff.maxGain).toBeGreaterThan(0);
    expect(analytics.payoff.breakevens.length).toBeGreaterThanOrEqual(1);
    expect(analytics.tauYears).toBeGreaterThan(0);
  });
});
