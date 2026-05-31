import { describe, expect, it } from 'vitest';
import { fairFromSvi, priceBasketSequential, type ImpactParams } from './impact';
import { optimize, optimizeBasket, optimizeSparse } from './optimizer';
import type { Decomposition, OracleState, SVI } from './types';

const oracle = {} as OracleState;

describe('optimize', () => {
  it('chooses a cheaper merged range over adjacent ranges', async () => {
    const base: Decomposition = {
      legCount: 2,
      legs: [
        { isRange: true, isUp: false, lowerStrike: 68_000, higherStrike: 69_000, quantity: 1_000_000 },
        { isRange: true, isUp: false, lowerStrike: 69_000, higherStrike: 70_000, quantity: 1_000_000 },
      ],
    };

    const res = await optimize(base, oracle, async (leg) => (leg.lowerStrike === 68_000 && leg.higherStrike === 70_000 ? 700 : 500));

    expect(res.best.legCount).toBe(1);
    expect(res.best.totalCost).toBe(700);
    expect(res.savingsVsNaive).toBe(300);
  });

  it('returns a sparse candidate under the PTB leg cap', () => {
    const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };
    const res = optimizeSparse(
      {
        gridStrikes: [90, 100, 110, 120, 130, 140],
        g: [0, 0, 1, 2, 2, 1],
      },
      svi,
      115,
    );

    expect(res.best.legCount).toBeLessThanOrEqual(8);
    expect(res.all).toHaveLength(3);
  });

  it('exposes impact-aware sequential basket optimization', () => {
    const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };
    const state = { mtm: 100_000, balance: 10_000_000 };
    const params: ImpactParams = { baseSpread: 0.02, minSpread: 0.005, utilMult: 1.5, minAsk: 0.01, maxAsk: 0.99, maxExposurePct: 0.8 };
    const legs = [
      { isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 1_000_000 },
      { isRange: false, isUp: true, lowerStrike: 110, higherStrike: 0, quantity: 2_000_000 },
    ];
    const fairOf = fairFromSvi(svi, 100);
    const priced = priceBasketSequential(legs, state, (leg) => fairOf(leg), params);
    const noUtilImpact = priceBasketSequential(legs, state, (leg) => fairOf(leg), { ...params, utilMult: 0 });
    const res = optimizeBasket(legs, svi, 100, state, params);

    expect(res.order).toHaveLength(2);
    expect(res.totalCost).toBeGreaterThan(0);
    expect(priced.sequential).toBeGreaterThan(priced.naive);
    expect(noUtilImpact.sequential).toBe(noUtilImpact.naive);
    expect(res.impactCost).toBeGreaterThan(0);
    expect(res.exposureOk).toBe(true);
  });
});
