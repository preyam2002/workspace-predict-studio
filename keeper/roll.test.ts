import { describe, expect, it } from 'vitest';
import { planKeeperRoll, selectRangeBand } from './roll';
import type { OracleState } from '../lib/types';

const oracle: OracleState = {
  predictId: '0x1',
  oracleId: '0x2',
  dbpPackage: '0xdbp',
  dusdcType: '0xd::dusdc::DUSDC',
  expiryMs: Date.now() - 1,
  nowMs: 0,
  spot: 100,
  forward: 100,
  status: 'settled',
  underlyingAsset: 'BTC',
  svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 },
  minStrike: 70,
  tickSize: 5,
  maxStrike: 130,
};

describe('keeper roll planning', () => {
  it('selects a range band that brackets the forward', () => {
    const band = selectRangeBand(oracle, { downsideDelta: 0.25, upsideDelta: 0.25 });
    expect(band.lowerStrike).toBeLessThan(oracle.forward);
    expect(band.higherStrike).toBeGreaterThan(oracle.forward);
  });

  it('plans a roll only after expiry or settlement', () => {
    expect(planKeeperRoll(oracle, { downsideDelta: 0.25, upsideDelta: 0.25 }, 1_000_000).action).toBe('roll');
    expect(
      planKeeperRoll(
        { ...oracle, status: 'active', expiryMs: Date.now() + 60_000 },
        { downsideDelta: 0.25, upsideDelta: 0.25 },
        1_000_000,
      ).action,
    ).toBe('wait');
  });
});
