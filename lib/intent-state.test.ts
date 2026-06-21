import { describe, expect, it } from 'vitest';
import { defaultIntentPrompt } from './intent-state';
import type { OracleState } from './types';

const oracle: OracleState = {
  predictId: '0x1',
  oracleId: '0x2',
  dbpPackage: '0xdbp',
  dusdcType: '0xd::dusdc::DUSDC',
  managerId: '0x3',
  expiryMs: Date.now() + 3_600_000,
  nowMs: Date.now(),
  spot: 65_000_000_000_000,
  forward: 65_000_000_000_000,
  status: 'active',
  underlyingAsset: 'BTC',
  svi: { a: 0.000001, b: 0.00001, rho: -0.3, m: 0, sigma: 0.001 },
  minStrike: 50_000_000_000_000,
  tickSize: 1_000_000_000,
  maxStrike: 90_000_000_000_000,
};

describe('intent prompt defaults', () => {
  it('anchors the default range around the live forward instead of hard-coded 90k/110k', () => {
    expect(defaultIntentPrompt(oracle)).toBe('BTC stays between 62k and 68k through expiry');
  });
});
