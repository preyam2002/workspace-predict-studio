import { describe, expect, it } from 'vitest';
import { catalogProducts } from './catalog';
import { solveSparse } from './solver';
import type { OracleState } from './types';

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
  it('builds non-negative sparse targets that fit under the PTB cap', () => {
    expect(catalogProducts).toHaveLength(12);

    for (const product of catalogProducts) {
      const target = product.build(oracle);
      expect(target.gridStrikes).toHaveLength(target.g.length);
      expect(target.g.every((v) => v >= 0)).toBe(true);

      const sol = solveSparse(target, { maxLegs: 8, tol: 0.01 });
      expect(sol.legCount, product.id).toBeLessThanOrEqual(8);
      expect(sol.maxAbsError, product.id).toBeLessThanOrEqual(0.5);
    }
  });
});
