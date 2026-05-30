import { describe, expect, it } from 'vitest';
import {
  defaultImpactParams,
  legCost,
  optimalOrder,
  priceBasketSequential,
  priceInOrder,
  splitAcrossCandidates,
  type AmmState,
  type ImpactParams,
} from './impact';
import type { Leg } from './types';

const params: ImpactParams = { baseSpread: 0.02, minSpread: 0.005, utilMult: 1.5, minAsk: 0.01, maxAsk: 0.99 };

describe('impact cost model', () => {
  it('utilization term makes a leg strictly more expensive as mtm rises', () => {
    const lo = legCost(0.5, 1_000, 10_000, 1, params);
    const hi = legCost(0.5, 6_000, 10_000, 1, params);
    expect(hi).toBeGreaterThan(lo);
  });

  it('sequential basket pricing is at least naive pricing with utilization impact', () => {
    const legs: Leg[] = [
      { isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 1_000 },
      { isRange: false, isUp: true, lowerStrike: 110, higherStrike: 0, quantity: 2_000 },
    ];
    const state = { mtm: 1_000, balance: 20_000 };
    const priced = priceBasketSequential(legs, state, () => 0.5, params);
    expect(priced.sequential).toBeGreaterThan(priced.naive);

    const flat = priceBasketSequential(legs, state, () => 0.5, { ...params, utilMult: 0 });
    expect(flat.sequential).toBeCloseTo(flat.naive, 8);
  });

  it('finds an optimal order no worse than identity and equal to brute force for small baskets', () => {
    const legs: Leg[] = [
      { isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 4_000 },
      { isRange: false, isUp: true, lowerStrike: 110, higherStrike: 0, quantity: 1_000 },
      { isRange: false, isUp: true, lowerStrike: 120, higherStrike: 0, quantity: 2_000 },
    ];
    const fair = (_leg: Leg, index: number) => [0.65, 0.2, 0.4][index];
    const state = { mtm: 2_000, balance: 30_000 };
    const best = optimalOrder(legs, state, fair, params);
    const identity = priceInOrder(legs, [0, 1, 2], state, fair, params);
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const brute = Math.min(...permutations.map((order) => priceInOrder(legs, order, state, fair, params)));

    expect(best.totalCost).toBeLessThanOrEqual(identity);
    expect(best.totalCost).toBeCloseTo(brute, 8);
  });

  it('splits a large leg across cheaper adjacent candidates while preserving quantity and exposure cap', () => {
    const parent: Leg = { isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 10_000 };
    const state: AmmState = { mtm: 1_000, balance: 100_000 };
    const single = legCost(0.55, state.mtm, state.balance, parent.quantity, defaultImpactParams);
    const split = splitAcrossCandidates(
      parent,
      [
        { leg: { ...parent, lowerStrike: 95 }, fairPrice: 0.45 },
        { leg: parent, fairPrice: 0.5 },
        { leg: { ...parent, lowerStrike: 105 }, fairPrice: 0.55 },
      ],
      state,
      defaultImpactParams,
    );

    expect(split.legs.reduce((sum, leg) => sum + leg.quantity, 0)).toBe(parent.quantity);
    expect(split.totalCost).toBeLessThan(single);
    expect(split.exposureOk).toBe(true);
  });
});
