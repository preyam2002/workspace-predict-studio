import { describe, expect, it } from 'vitest';
import { catalogProducts } from './catalog';
import { legPays } from './payoff';
import { solveSparse } from './solver';
import { USDC, type OracleState, type SparseTarget } from './types';

const oracle: OracleState = {
  predictId: '0x1',
  oracleId: '0x2',
  dbpPackage: '0xdbp',
  dusdcType: '0xd::dusdc::DUSDC',
  expiryMs: 1,
  nowMs: 0,
  spot: 100,
  forward: 100,
  status: 'active',
  underlyingAsset: 'BTC',
  svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 },
  minStrike: 70,
  tickSize: 5,
  maxStrike: 130,
};

describe('catalogProducts', () => {
  function reconstruct(target: SparseTarget, legs: ReturnType<typeof solveSparse>['legs']): number[] {
    return target.gridStrikes.map((strike) => legs.reduce((sum, leg) => sum + (legPays(leg, strike) ? leg.quantity / USDC : 0), 0));
  }

  it('builds non-negative sparse targets that fit under the PTB cap', () => {
    expect(catalogProducts.map((product) => product.id)).toEqual([
      'capped_bull_note',
      'capped_bear_note',
      'digital_call_note',
      'digital_put_note',
      'iron_condor_income',
      'twin_win',
      'shark_fin',
      'fixed_coupon_range',
      'digital_ladder',
      'barrier_box',
      'butterfly_pin',
      'dual_range_barbell',
    ]);

    for (const product of catalogProducts) {
      const target = product.build(oracle);
      expect(target.gridStrikes).toHaveLength(target.g.length);
      expect(target.g.every((v) => v >= 0)).toBe(true);

      const sol = solveSparse(target, { maxLegs: 8, tol: 0.01 });
      const fitted = reconstruct(target, sol.legs);
      const maxReconstructionError = Math.max(...fitted.map((value, i) => Math.abs(value - target.g[i])));

      expect(sol.legCount, product.id).toBeLessThanOrEqual(8);
      expect(maxReconstructionError, product.id).toBeCloseTo(sol.maxAbsError, 12);
      expect(maxReconstructionError, product.id).toBeLessThanOrEqual(0.01);
    }
  });
});
