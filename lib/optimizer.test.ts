import { describe, expect, it } from 'vitest';
import { optimize } from './optimizer';
import type { Decomposition, OracleState } from './types';

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
});
