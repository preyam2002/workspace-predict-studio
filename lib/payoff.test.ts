import { describe, expect, it } from 'vitest';
import {
  breakevens,
  basketGreeks,
  clearPricingCaches,
  ev,
  greeksLeg,
  greeksUp,
  impliedProb,
  maxGain,
  maxLoss,
  payoffCurve,
  pnlAt,
  priceRange,
  priceUp,
  pricingCacheSizes,
} from './payoff';
import type { Leg, SVI } from './types';

const svi: SVI = { a: 0.000000283, b: 0.000008064, rho: -0.94, m: -0.000943815, sigma: 0.001 };

describe('payoff analytics', () => {
  const legs: Leg[] = [
    { isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 },
    { isRange: true, isUp: false, lowerStrike: 68_000, higherStrike: 70_000, quantity: 1_000_000 },
  ];

  it('computes settlement PnL, max loss, max gain, and crossings', () => {
    expect(pnlAt(legs, 400_000, 69_000)).toBe(600_000);
    expect(pnlAt(legs, 400_000, 71_000)).toBe(600_000);
    expect(maxLoss(400_000)).toBe(400_000);
    expect(maxGain(legs, 400_000)).toBe(600_000);
    expect(breakevens(legs, 400_000).length).toBeGreaterThan(0);
    expect(payoffCurve(legs, 400_000, 65_000, 75_000, 10)).toHaveLength(11);
  });

  it('keeps SVI probabilities and greeks finite', () => {
    expect(impliedProb(400_000_000)).toBeCloseTo(0.4);
    expect(priceUp(svi, 70_000, 70_000)).toBeGreaterThan(0);
    expect(priceRange(svi, 70_000, 68_000, 72_000)).toBeGreaterThan(0);
    expect(ev(legs, svi, 70_000, 400_000)).toBeGreaterThan(-400_000);
    expect(Object.values(greeksUp(svi, 70_000, 70_000, 1 / 365)).every(Number.isFinite)).toBe(true);
  });

  it('aggregates basket greeks additively across long legs', () => {
    const greekSvi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };
    const tauYears = 7 / 365;
    const upLeg: Leg = { isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 2_000_000 };
    const downLeg: Leg = { isRange: false, isUp: false, lowerStrike: 100, higherStrike: 0, quantity: 1_000_000 };
    const up = greeksLeg(greekSvi, 100, upLeg, tauYears);
    const down = greeksLeg(greekSvi, 100, downLeg, tauYears);
    const basket = basketGreeks([upLeg, downLeg], greekSvi, 100, tauYears);

    expect(up.delta).toBeGreaterThan(0);
    expect(down.delta).toBeLessThan(0);
    expect(basket.mark).toBeCloseTo(up.mark + down.mark, 6);
    expect(basket.delta).toBeCloseTo(up.delta + down.delta, 12);
    expect(basket.gamma).toBeCloseTo(up.gamma + down.gamma, 12);
    expect(basket.vega).toBeCloseTo(up.vega + down.vega, 6);
    expect(basket.theta).toBeCloseTo(up.theta + down.theta, 6);
    expect(Object.values(basket).every(Number.isFinite)).toBe(true);
  });

  it('memoizes arb-guard checks per SVI surface', () => {
    clearPricingCaches();
    priceUp(svi, 70_000, 70_000);
    priceRange(svi, 70_000, 68_000, 72_000);
    priceUp({ ...svi }, 71_000, 70_000);
    expect(pricingCacheSizes().guard).toBe(1);
  });
});
