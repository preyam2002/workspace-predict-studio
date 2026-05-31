export const PYTH_HERMES_URL = 'https://hermes-beta.pyth.network';
export const PYTH_TESTNET_STATE_ID = '0x243759059f4c3111179da5878c12f68d612c21a8d54d85edc86164bb18be1c7c';
export const PYTH_TESTNET_WORMHOLE_STATE_ID = '0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790';
export const PYTH_BTC_USD_FEED_ID = '0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b';

export interface PythPrice {
  price: string | number;
  expo: number;
  publishTime?: number;
  publish_time?: number;
  conf?: string | number;
}

export interface PythParsedPriceUpdate {
  id: string;
  price: PythPrice;
  ema_price?: PythPrice;
}

export interface PythNavAnchor {
  feedId?: string;
  price: number;
  confidence?: number;
  emaPrice?: number;
  stale: boolean;
  publishTime?: number;
}

export interface PythHermesConnection {
  getLatestPriceUpdates(ids: string[], options: { parsed: true }): Promise<{ parsed?: PythParsedPriceUpdate[] | null }>;
  getPriceFeedsUpdateData?: (ids: string[]) => Promise<Uint8Array[]>;
}

export interface PythUpdateClient {
  updatePriceFeeds(tx: unknown, updates: Uint8Array[], feedIds: string[]): Promise<string[]>;
}

export interface PythSuiConfig {
  pythStateId: string;
  wormholeStateId: string;
}

export function normalizePythFeedId(feedId: string): string {
  const hex = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
  return `0x${hex.toLowerCase()}`;
}

export function normalizePythPrice(price: PythPrice): number {
  return Number(price.price) * 10 ** price.expo;
}

export function normalizePythConfidence(price: PythPrice): number | undefined {
  return price.conf === undefined ? undefined : Number(price.conf) * 10 ** price.expo;
}

export function pythPublishTime(price: PythPrice): number | undefined {
  return price.publishTime ?? price.publish_time;
}

export function pythNavAnchor(price: PythPrice, nowSec: number, maxAgeSec = 60): PythNavAnchor {
  const publishTime = pythPublishTime(price);
  return {
    price: normalizePythPrice(price),
    confidence: normalizePythConfidence(price),
    stale: publishTime === undefined ? true : nowSec - publishTime > maxAgeSec,
    publishTime,
  };
}

export async function createPythConnection(endpoint = PYTH_HERMES_URL): Promise<PythHermesConnection> {
  const { SuiPriceServiceConnection } = await import('@pythnetwork/pyth-sui-js/SuiPriceServiceConnection');
  return new SuiPriceServiceConnection(endpoint);
}

export async function fetchPythNavAnchor(
  feedId = PYTH_BTC_USD_FEED_ID,
  nowSec = Math.floor(Date.now() / 1000),
  connection?: PythHermesConnection,
  maxAgeSec = 60,
): Promise<PythNavAnchor> {
  const normalizedFeedId = normalizePythFeedId(feedId);
  const source = connection ?? (await createPythConnection());
  const update = await source.getLatestPriceUpdates([normalizedFeedId], { parsed: true });
  const parsed = update.parsed?.find((item) => normalizePythFeedId(item.id) === normalizedFeedId);
  if (!parsed) throw new Error(`Pyth price not returned for feed ${normalizedFeedId}`);

  return {
    ...pythNavAnchor(parsed.price, nowSec, maxAgeSec),
    feedId: normalizedFeedId,
    emaPrice: parsed.ema_price ? normalizePythPrice(parsed.ema_price) : undefined,
  };
}

export async function getPythPriceFeedUpdateData(
  feedIds = [PYTH_BTC_USD_FEED_ID],
  connection?: PythHermesConnection,
): Promise<Uint8Array[]> {
  const source = connection ?? (await createPythConnection());
  if (!source.getPriceFeedsUpdateData) throw new Error('Pyth connection does not support price-feed update data');
  return source.getPriceFeedsUpdateData(feedIds.map(normalizePythFeedId));
}

export async function createPythUpdateClient(
  suiClient: unknown,
  config: PythSuiConfig = {
    pythStateId: PYTH_TESTNET_STATE_ID,
    wormholeStateId: PYTH_TESTNET_WORMHOLE_STATE_ID,
  },
): Promise<PythUpdateClient> {
  const { SuiPythClient } = await import('@pythnetwork/pyth-sui-js/client');
  return new SuiPythClient(suiClient as never, config.pythStateId, config.wormholeStateId) as PythUpdateClient;
}

export async function buildPythPriceFeedUpdate(
  tx: unknown,
  suiClient: unknown,
  feedIds = [PYTH_BTC_USD_FEED_ID],
  options: {
    connection?: PythHermesConnection;
    pythClient?: PythUpdateClient;
    config?: PythSuiConfig;
  } = {},
): Promise<string[]> {
  const normalizedFeedIds = feedIds.map(normalizePythFeedId);
  const updateData = await getPythPriceFeedUpdateData(normalizedFeedIds, options.connection);
  const client = options.pythClient ?? (await createPythUpdateClient(suiClient, options.config));
  return client.updatePriceFeeds(tx, updateData, normalizedFeedIds);
}
