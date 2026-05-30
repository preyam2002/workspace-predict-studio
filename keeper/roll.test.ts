import { describe, expect, it } from 'vitest';
import { buildKeeperRollDryRun, chooseStrikeForUpProbability, planKeeperRoll, selectRangeBand } from './roll';
import { priceUp } from '../lib/payoff';
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
const vaultId = '0x00000000000000000000000000000000000000000000000000000000000000aa';
const keeperCapId = '0x00000000000000000000000000000000000000000000000000000000000000bb';
const studioPackage = '0x0000000000000000000000000000000000000000000000000000000000000004';

describe('keeper roll planning', () => {
  it('selects a range band that brackets the forward', () => {
    const band = selectRangeBand(oracle, { downsideDelta: 0.25, upsideDelta: 0.25 });
    expect(band.lowerStrike).toBeLessThan(oracle.forward);
    expect(band.higherStrike).toBeGreaterThan(oracle.forward);
  });

  it('keeps reselection inside Predict ask bounds when available', () => {
    const strike = chooseStrikeForUpProbability(oracle, 0.99, { minAsk: 0.2, maxAsk: 0.8 });
    const up = priceUp(oracle.svi, oracle.forward, strike);
    expect(up).toBeGreaterThanOrEqual(0.2);
    expect(up).toBeLessThanOrEqual(0.8);
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

  it('builds a keeper roll PTB only when the plan rolls', () => {
    const roll = buildKeeperRollDryRun(
      {
        studioPackage,
        vaultId,
        keeperCapId,
        quoteType: oracle.dusdcType,
        budget: 1_000_000,
        downsideDelta: 0.25,
        upsideDelta: 0.25,
      },
      oracle,
    );
    expect(roll.tx?.getData().commands.some((command) => command.MoveCall?.function === 'keeper_roll')).toBe(true);

    const wait = buildKeeperRollDryRun(
      {
        studioPackage,
        vaultId,
        keeperCapId,
        quoteType: oracle.dusdcType,
        budget: 1_000_000,
        downsideDelta: 0.25,
        upsideDelta: 0.25,
      },
      { ...oracle, status: 'active', expiryMs: Date.now() + 60_000 },
    );
    expect(wait.tx).toBeUndefined();
  });
});
