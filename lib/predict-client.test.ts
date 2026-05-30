import { describe, expect, it } from 'vitest';
import { PredictClient, decodeU64LE, structuredPositionFromObject } from './predict-client';
import { structureHash } from './rfq';
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
    const client = new PredictClient({} as never, '0x4', '0xdbp');
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

  it('builds an RFQ fill transaction bound to the signed structure hash', () => {
    const client = new PredictClient({} as never, '0x4', '0xdbp');
    const legs = [{ isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 }];
    const tx = client.buildFillQuoteTx(
      oracle,
      '0x5',
      legs,
      'digital_call',
      {
        structureHash: structureHash(legs, 'digital_call'),
        premium: 500_000,
        maker: '0x00000000000000000000000000000000000000000000000000000000000000aa',
        expiryMs: 999_999_999,
        nonce: 1,
      },
      new Uint8Array(32),
      new Uint8Array(64),
    );
    expect(tx.getData().commands.some((command) => command.MoveCall?.function === 'fill_quote')).toBe(true);
  });

  it('parses owned StructuredPosition object fields into a dashboard summary', async () => {
    const object = {
      objectId: '0xposition',
      content: {
        dataType: 'moveObject',
        fields: {
          owner: '0xabc',
          manager_id: '0x3',
          oracle_id: '0x2',
          expiry_ms: '12345',
          shape: 'digital_call',
          legs: [
            {
              fields: {
                is_range: false,
                is_up: true,
                lower_strike: '70000',
                higher_strike: '0',
                quantity: '1000000',
              },
            },
          ],
          premium_paid: '500000',
          max_loss: '500000',
          max_gain: '1000000',
          settled: false,
        },
      },
    };

    expect(structuredPositionFromObject(object)).toMatchObject({
      objectId: '0xposition',
      shape: 'digital_call',
      premiumPaid: 500_000,
      legs: [{ isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 }],
    });

    const client = new PredictClient(
      {
        getOwnedObjects: async () => ({ data: [{ data: object }] }),
      } as never,
      '0x4',
      '0xdbp',
    );
    await expect(client.listPositions('0xabc')).resolves.toHaveLength(1);
  });
});
