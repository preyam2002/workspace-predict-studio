import { describe, expect, it } from 'vitest';
import { markLegs, markVaultNav } from './nav';
import { USDC, type Leg, type SVI } from './types';

const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };

describe('vault NAV marking', () => {
  it('marks a long-only basket from SVI probabilities plus idle cash', () => {
    const legs: Leg[] = [{ isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: USDC }];
    const marked = markLegs(legs, svi, 100);

    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(USDC);
    expect(markVaultNav({ idle: 2 * USDC, legs, svi, forward: 100 })).toBe(2 * USDC + marked);
  });
});
