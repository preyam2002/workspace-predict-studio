import { describe, expect, it, vi } from 'vitest';

vi.mock('./indexer', () => ({
  getOracles: vi.fn(async () => [
    {
      predict_id: '0xpredict',
      oracle_id: '0xoracle',
      underlying_asset: 'BTC',
      expiry: 123,
      min_strike: 10,
      tick_size: 5,
      max_strike: 777,
      status: 'active',
    },
  ]),
}));

import { loadOracleState } from './predict-client';

describe('loadOracleState', () => {
  it('uses an exposed max_strike instead of the wide heuristic', async () => {
    const state = await loadOracleState({
      getObject: async () => ({
        data: {
          type: '0xdbp::oracle::OracleSVI',
          content: {
            dataType: 'moveObject',
            fields: {
              active: true,
              expiry: '123',
              prices: { fields: { forward: '100', spot: '100' } },
              svi: {
                fields: {
                  a: '1',
                  b: '2',
                  rho: { fields: { is_negative: false, magnitude: '3' } },
                  m: { fields: { is_negative: true, magnitude: '4' } },
                  sigma: '5',
                },
              },
              underlying_asset: 'BTC',
            },
          },
        },
      }),
    } as never);

    expect(state.maxStrike).toBe(777);
  });
});
