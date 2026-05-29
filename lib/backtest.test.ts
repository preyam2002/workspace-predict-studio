import { describe, expect, it } from 'vitest';
import { backtest } from './backtest';

describe('backtest', () => {
  it('replays a structure against settlements', () => {
    const result = backtest(
      [{ isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 }],
      400_000,
      [
        { settlementPrice: 69_000, expiryMs: 1 },
        { settlementPrice: 71_000, expiryMs: 2 },
      ],
    );

    expect(result.runs).toBe(2);
    expect(result.hitRate).toBe(0.5);
    expect(result.avgPnl).toBe(100_000);
  });
});
