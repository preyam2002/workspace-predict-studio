import { rankPublishers, type PublisherRank } from './creator';

export const PREDICT_INDEXER_BASE = 'https://predict-server.testnet.mystenlabs.com';

export interface IndexerOracle {
  predict_id: string;
  oracle_id: string;
  oracle_cap_id?: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: string;
  activated_at?: number;
  settlement_price?: number;
  settled_at?: number;
  created_checkpoint?: number;
  max_strike?: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${PREDICT_INDEXER_BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function getOracles(): Promise<IndexerOracle[]> {
  return get<IndexerOracle[]>('/oracles');
}

export function activeOracleChoices(oracles: IndexerOracle[], asset = 'BTC', nowMs = Date.now()) {
  return oracles
    .filter((oracle) => oracle.underlying_asset === asset && oracle.status === 'active' && Number(oracle.expiry) > nowMs)
    .sort((a, b) => Number(a.expiry) - Number(b.expiry));
}

export function getManagerPositions(id: string) {
  return get(`/managers/${id}/positions/summary`);
}

export function getManagerPnl(id: string) {
  return get(`/managers/${id}/pnl`);
}

export async function getPrices(oracleId: string) {
  const oracles = await getOracles();
  const oracle = oracles.find((item) => item.oracle_id === oracleId);
  if (!oracle) throw new Error(`oracle not found in /oracles: ${oracleId}`);
  return oracle;
}

export async function getSettledHistory(asset = 'BTC') {
  const oracles = await getOracles();
  return settledHistoryFromOracles(oracles, asset);
}

export function settledHistoryFromOracles(oracles: IndexerOracle[], asset = 'BTC') {
  return oracles
    .filter((oracle) => oracle.underlying_asset === asset && oracle.status === 'settled' && oracle.settlement_price !== undefined)
    .sort((a, b) => Number(b.expiry) - Number(a.expiry))
    .map((oracle) => ({ settlementPrice: Number(oracle.settlement_price), expiryMs: Number(oracle.expiry) }));
}

type EventLike = Record<string, unknown> & { parsedJson?: unknown };

interface EventClient {
  queryEvents(args: {
    query: { MoveEventType: string };
    limit?: number;
    order?: 'ascending' | 'descending';
  }): Promise<{ data: EventLike[] }>;
}

function eventFields(event: EventLike): Record<string, unknown> {
  return typeof event.parsedJson === 'object' && event.parsedJson !== null
    ? (event.parsedJson as Record<string, unknown>)
    : event;
}

function numberField(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  if (value === undefined || value === null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function publisherLeaderboardFromEvents(events: EventLike[]): PublisherRank[] {
  return rankPublishers(
    events.flatMap((event) => {
      const fields = eventFields(event);
      const publisher = typeof fields.publisher === 'string' ? fields.publisher : undefined;
      if (!publisher || publisher === '0x0') return [];

      const feePaid = numberField(fields, 'fee_paid');
      const feeBps = numberField(fields, 'fee_bps');
      const volume =
        numberField(fields, 'volume') ??
        numberField(fields, 'premium_paid') ??
        numberField(fields, 'amount') ?? // note_kiosk::RoyaltyPaid carries the royalty as `amount`
        (feePaid !== undefined && feeBps ? Math.floor((feePaid * 10_000) / feeBps) : undefined);
      if (volume === undefined) return [];

      return [
        {
          publisher,
          volume,
          realizedPayout: numberField(fields, 'realized_payout') ?? numberField(fields, 'payout') ?? 0,
        },
      ];
    }),
  );
}

export async function getPublisherLeaderboard(
  client: EventClient,
  studioPackage: string,
  limit = 50,
  kioskPackage?: string,
): Promise<PublisherRank[]> {
  const eventTypes = [
    `${studioPackage}::studio::PublisherFeePaid`,
    `${studioPackage}::vault::PublisherFeePaid`,
    `${studioPackage}::note_kiosk::RoyaltyPaid`,
  ];
  // Kiosk royalties live on a dedicated package (with the Publisher-claiming init); include
  // its RoyaltyPaid stream so real creator-note resales show up on the leaderboard.
  if (kioskPackage && kioskPackage !== studioPackage) {
    eventTypes.push(`${kioskPackage}::note_kiosk::RoyaltyPaid`);
  }
  const results = await Promise.allSettled(
    eventTypes.map((eventType) =>
      client.queryEvents({
        query: { MoveEventType: eventType },
        limit,
        order: 'descending',
      }),
    ),
  );
  return publisherLeaderboardFromEvents(
    results.flatMap((result) => (result.status === 'fulfilled' ? result.value.data : [])),
  );
}
