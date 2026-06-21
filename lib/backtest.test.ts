import { describe, expect, it } from 'vitest';
import { backtest, backtestWithModelSimulation, syntheticSettlements } from './backtest';

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
    expect(result.source).toBe('history');
  });

  it('uses deterministic synthetic settlements when settled history is thin', () => {
    const first = syntheticSettlements(100, 0.8, 1 / 365, 4, 123).map((item) => item.settlementPrice);
    const second = syntheticSettlements(100, 0.8, 1 / 365, 4, 123).map((item) => item.settlementPrice);
    expect(first).toEqual(second);

    const result = backtestWithModelSimulation(
      [{ isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: 1_000_000 }],
      400_000,
      [],
      {
        expiryMs: Date.now() + 60 * 60 * 1000,
        nowMs: Date.now(),
        forward: 100,
        svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 },
      },
    );
    expect(result.source).toBe('synthetic');
    expect(result.runs).toBe(500);
  });
});
