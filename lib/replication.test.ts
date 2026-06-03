import { describe, expect, it } from 'vitest';
import { catalogProducts } from './catalog';
import { legPays } from './payoff';
import { solveSparse } from './solver';
import { USDC, type OracleState } from './types';

function oracleFor(seed: number): OracleState {
  const forward = 100 + (seed % 5) * 5;
  return {
    predictId: '0x1',
    oracleId: '0x2',
    dbpPackage: '0xdbp',
    dusdcType: '0xd::dusdc::DUSDC',
    expiryMs: 1,
    nowMs: 0,
    spot: forward,
    forward,
    status: 'active',
    underlyingAsset: 'BTC',
    svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 },
    minStrike: 70,
    tickSize: 5,
    maxStrike: 140,
  };
}

describe('replication settlement property', () => {
  it('matches replicated leg payout to the target payoff across sampled catalog notes and settlements', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      const oracle = oracleFor(seed);
      const product = catalogProducts[(seed * 7) % catalogProducts.length];
      const target = product.build(oracle);
      const solution = solveSparse(target, { maxLegs: 8, tol: 0.01 });

      for (let i = 0; i < target.gridStrikes.length; i += 1) {
        const settlement = target.gridStrikes[i];
        const payout = solution.legs.reduce((sum, leg) => sum + (legPays(leg, settlement) ? leg.quantity / USDC : 0), 0);
        expect(Math.abs(payout - target.g[i]), `${product.id}@${settlement}`).toBeLessThanOrEqual(0.01);
      }
    }
  });
});
