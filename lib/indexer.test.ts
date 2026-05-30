import { describe, expect, it } from 'vitest';
import { getPublisherLeaderboard, publisherLeaderboardFromEvents } from './indexer';

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
