import { describe, expect, it } from 'vitest';
import { PredictClient, decodeU64LE } from './predict-client';
import type { OracleState } from './types';

const oracle: OracleState = {
  predictId: '0x1',
  oracleId: '0x2',
  dbpPackage: '0xdbp',
  dusdcType: '0xd::dusdc::DUSDC',
  managerId: '0x3',
  expiryMs: 1,
  nowMs: 0,
  spot: 70_000,
  forward: 70_000,
  status: 'active',
  underlyingAsset: 'BTC',
  svi: { a: 0.000001, b: 0.00001, rho: -0.3, m: 0, sigma: 0.001 },
  minStrike: 50_000,
  tickSize: 100,
  maxStrike: 90_000,
};

describe('PredictClient', () => {
  it('decodes little-endian u64 return bytes', () => {
    expect(decodeU64LE([0x40, 0x42, 0x0f, 0, 0, 0, 0, 0])).toBe(1_000_000);
  });

  it('quotes ask cost from devInspect return values', async () => {
    const client = new PredictClient(
      {
        devInspectTransactionBlock: async () => ({
          results: [{ returnValues: [[[0x2a, 0, 0, 0, 0, 0, 0, 0], 'u64'], [[0x10, 0, 0, 0, 0, 0, 0, 0], 'u64']] }],
        }),
      } as never,
      '0xstudio',
      '0xdbp',
    );

    await expect(
      client.quoteLeg(oracle, { isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 }, '0xabc'),
    ).resolves.toBe(42);
  });

  it('builds mint and settle transactions without requiring network IO', () => {
    const client = new PredictClient({} as never, '0xstudio', '0xdbp');
    expect(() =>
      client.buildMintTx(
        oracle,
        [{ isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 }],
        'digital_call',
        500_000,
      ),
    ).not.toThrow();
    expect(() => client.buildSettleTx(oracle, '0xposition')).not.toThrow();
  });
});
