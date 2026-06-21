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

import { isLiveOracleState, loadOracleState, selectLiveIndexerOracle } from './predict-client';

describe('loadOracleState', () => {
  it('ignores a preferred settled oracle and selects the active unexpired market', () => {
    const nowMs = 2_000;
    const selected = selectLiveIndexerOracle(
      [
        {
          predict_id: '0xsettledPredict',
          oracle_id: '0xsettled',
          underlying_asset: 'BTC',
          expiry: 1_000,
          min_strike: 10,
          tick_size: 5,
          status: 'settled',
        },
        {
          predict_id: '0xactivePredict',
          oracle_id: '0xactive',
          underlying_asset: 'BTC',
          expiry: 3_000,
          min_strike: 10,
          tick_size: 5,
          status: 'active',
        },
      ],
      '0xsettled',
      nowMs,
    );

    expect(selected?.oracle_id).toBe('0xactive');
  });

  it('treats active-but-expired oracle state as not live', () => {
    expect(isLiveOracleState({ status: 'active', expiryMs: 1_000 }, 2_000)).toBe(false);
    expect(isLiveOracleState({ status: 'settled', expiryMs: 3_000 }, 2_000)).toBe(false);
    expect(isLiveOracleState({ status: 'active', expiryMs: 3_000 }, 2_000)).toBe(true);
  });

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
