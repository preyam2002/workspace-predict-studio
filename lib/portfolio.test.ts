import { describe, expect, it } from 'vitest';
import { borrowCapacity, portfolioNav, scenarioGrid, type PortfolioPosition } from './portfolio';
import { USDC, type SVI } from './types';

const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };

const positions: PortfolioPosition[] = [
  {
    legs: [{ isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: USDC }],
    premium: 400_000,
    worstCaseFloor: 100_000,
  },
  {
    legs: [{ isRange: false, isUp: false, lowerStrike: 90, higherStrike: 0, quantity: 2 * USDC }],
    premium: 500_000,
    worstCaseFloor: 200_000,
  },
  {
    legs: [{ isRange: true, isUp: false, lowerStrike: 95, higherStrike: 105, quantity: USDC }],
    premium: 300_000,
  },
];

describe('portfolio analytics', () => {
  it('aggregates NAV, premium, floor, and finite-difference greeks', () => {
    const res = portfolioNav(positions, svi, 100);
    expect(res.nav).toBeGreaterThan(0);
    expect(res.premiumPaid).toBe(1_200_000);
    expect(res.worstCaseFloor).toBe(300_000);
    expect(Number.isFinite(res.delta)).toBe(true);
    expect(Number.isFinite(res.vega)).toBe(true);
  });

  it('builds a 15-cell spot/IV scenario grid', () => {
    const grid = scenarioGrid(positions, svi, 100);
    expect(grid).toHaveLength(15);
    expect(grid.some((cell) => cell.spotShockPct === 0 && cell.ivShockPct === 0 && Math.abs(cell.pnl) < 1e-6)).toBe(true);
  });

  it('keeps a long-call scenario grid monotone in spot for a fixed IV shock', () => {
    const callOnly: PortfolioPosition[] = [
      {
        legs: [{ isRange: false, isUp: true, lowerStrike: 100, higherStrike: 0, quantity: USDC }],
        premium: 0,
      },
    ];
    const grid = scenarioGrid(callOnly, svi, 100, [-20, -10, 0, 10, 20], [0]);

    for (let i = 1; i < grid.length; i += 1) {
      expect(grid[i].nav).toBeGreaterThanOrEqual(grid[i - 1].nav);
    }
  });

  it('computes borrow capacity from the provable worst-case floor', () => {
    expect(borrowCapacity(positions, 0.5)).toBe(150_000);
  });
});
