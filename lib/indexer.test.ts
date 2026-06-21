import { describe, expect, it } from 'vitest';
import { activeOracleChoices, getPublisherLeaderboard, publisherLeaderboardFromEvents, settledHistoryFromOracles } from './indexer';

describe('publisher leaderboard indexing', () => {
  it('aggregates publisher fee events by implied premium volume', () => {
    const ranks = publisherLeaderboardFromEvents([
      { parsedJson: { publisher: '0xalice', fee_paid: '100', fee_bps: '10', realized_payout: '50' } },
      { parsedJson: { publisher: '0xbob', volume: '50000' } },
      { parsedJson: { publisher: '0xalice', premium_paid: '25000', payout: '10' } },
      { parsedJson: { publisher: '0x0', fee_paid: '100', fee_bps: '10' } },
    ]);

    expect(ranks[0]).toMatchObject({ publisher: '0xalice', volume: 125_000, realizedPayout: 60, fills: 2 });
    expect(ranks[1]).toMatchObject({ publisher: '0xbob', volume: 50_000, fills: 1 });
  });

  it('queries studio and note royalty events, tolerating unavailable event types', async () => {
    const ranks = await getPublisherLeaderboard(
      {
        queryEvents: async ({ query }) => {
          if (query.MoveEventType.endsWith('note_kiosk::RoyaltyPaid')) throw new Error('not deployed');
          if (query.MoveEventType.endsWith('studio::PublisherFeePaid')) return { data: [] };
          return { data: [{ parsedJson: { publisher: '0xalice', fee_paid: '100', fee_bps: '10' } }] };
        },
      },
      '0x4',
    );

    expect(ranks).toEqual([{ publisher: '0xalice', volume: 100_000, realizedPayout: 0, fills: 1 }]);
  });
});

describe('settled history indexing', () => {
  it('keeps zero settlement prices and sorts newest first', () => {
    expect(
      settledHistoryFromOracles([
        {
          predict_id: '0x1',
          oracle_id: '0x2',
          underlying_asset: 'BTC',
          expiry: 10,
          min_strike: 0,
          tick_size: 1,
          status: 'settled',
          settlement_price: 0,
        },
        {
          predict_id: '0x1',
          oracle_id: '0x3',
          underlying_asset: 'ETH',
          expiry: 20,
          min_strike: 0,
          tick_size: 1,
          status: 'settled',
          settlement_price: 2,
        },
        {
          predict_id: '0x1',
          oracle_id: '0x4',
          underlying_asset: 'BTC',
          expiry: 30,
          min_strike: 0,
          tick_size: 1,
          status: 'settled',
          settlement_price: 3,
        },
      ]),
    ).toEqual([
      { settlementPrice: 3, expiryMs: 30 },
      { settlementPrice: 0, expiryMs: 10 },
    ]);
  });
});

describe('active oracle choices', () => {
  it('returns live BTC expiries sorted from soonest to latest', () => {
    expect(
      activeOracleChoices(
        [
          {
            predict_id: '0x1',
            oracle_id: '0xlate',
            underlying_asset: 'BTC',
            expiry: 5_000,
            min_strike: 0,
            tick_size: 1,
            status: 'active',
          },
          {
            predict_id: '0x1',
            oracle_id: '0xexpired',
            underlying_asset: 'BTC',
            expiry: 1_000,
            min_strike: 0,
            tick_size: 1,
            status: 'active',
          },
          {
            predict_id: '0x1',
            oracle_id: '0xeth',
            underlying_asset: 'ETH',
            expiry: 3_000,
            min_strike: 0,
            tick_size: 1,
            status: 'active',
          },
          {
            predict_id: '0x1',
            oracle_id: '0xsoon',
            underlying_asset: 'BTC',
            expiry: 3_000,
            min_strike: 0,
            tick_size: 1,
            status: 'active',
          },
        ],
        'BTC',
        2_000,
      ).map((oracle) => oracle.oracle_id),
    ).toEqual(['0xsoon', '0xlate']);
  });
});
