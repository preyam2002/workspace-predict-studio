import { describe, expect, it } from 'vitest';
import { navDiscountPct, quoteConstantProductExit } from './cetus';
import { builderFee, capacityCappedBuilderFee, rankPublishers } from './creator';
import { buildSponsoredTransactionRequest, enokiAuthProvidersFromEnv, requestSponsoredTransaction, sponsorConfigFromEnv } from './enoki';
import {
  PYTH_BTC_USD_FEED_ID,
  buildPythPriceFeedUpdate,
  fetchPythNavAnchor,
  normalizePythFeedId,
  pythNavAnchor,
} from './pyth';
import { getWalrusJson, hashWalrusPayload, putWalrusJson } from './walrus';

describe('composability helpers', () => {
  it('builds and posts sponsored transaction requests', async () => {
    const cfg = sponsorConfigFromEnv({
      NEXT_PUBLIC_ENOKI_SPONSOR_URL: 'https://sponsor.example',
      NEXT_PUBLIC_ENOKI_APP_ID: 'app',
      NEXT_PUBLIC_SUI_NETWORK: 'testnet',
    });
    expect(cfg).toBeDefined();
    const req = buildSponsoredTransactionRequest('AA==', '0xabc', cfg!);
    const res = await requestSponsoredTransaction(req, cfg!, async (_url, init) => {
      expect(JSON.parse(String(init?.body)).appId).toBe('app');
      return new Response(JSON.stringify({ digest: '0xdigest' }), { status: 200 });
    });
    expect(res.digest).toBe('0xdigest');
  });

  it('builds Enoki auth provider config from public env only when configured', () => {
    expect(enokiAuthProvidersFromEnv({})).toBeUndefined();
    expect(
      enokiAuthProvidersFromEnv({
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'google-client',
      }),
    ).toEqual({ google: { clientId: 'google-client' } });
  });

  it('normalizes Pyth prices and flags stale anchors', () => {
    const fresh = pythNavAnchor({ price: '7012345678900', expo: -8, publishTime: 100 }, 120);
    expect(fresh.price).toBeCloseTo(70_123.456789);
    expect(fresh.stale).toBe(false);
    expect(pythNavAnchor({ price: '1', expo: 0, publishTime: 1 }, 120).stale).toBe(true);
  });

  it('fetches a parsed Pyth NAV anchor through the Hermes SDK contract', async () => {
    const anchor = await fetchPythNavAnchor(PYTH_BTC_USD_FEED_ID, 120, {
      async getLatestPriceUpdates(ids, options) {
        expect(ids).toEqual([PYTH_BTC_USD_FEED_ID]);
        expect(options).toEqual({ parsed: true });
        return {
          parsed: [
            {
              id: PYTH_BTC_USD_FEED_ID.slice(2),
              price: { price: '7012345678900', conf: '100000000', expo: -8, publish_time: 100 },
              ema_price: { price: '7011000000000', conf: '200000000', expo: -8, publish_time: 99 },
            },
          ],
        };
      },
    });

    expect(anchor.feedId).toBe(PYTH_BTC_USD_FEED_ID);
    expect(anchor.price).toBeCloseTo(70_123.456789);
    expect(anchor.confidence).toBe(1);
    expect(anchor.emaPrice).toBe(70_110);
    expect(anchor.stale).toBe(false);
  });

  it('builds a Pyth price-feed update against the Sui SDK wrapper', async () => {
    const tx = {};
    const updateBytes = [new Uint8Array([1, 2, 3])];
    const priceInfoIds = await buildPythPriceFeedUpdate(tx, {}, [PYTH_BTC_USD_FEED_ID.slice(2)], {
      connection: {
        async getLatestPriceUpdates() {
          throw new Error('not used');
        },
        async getPriceFeedsUpdateData(ids) {
          expect(ids).toEqual([PYTH_BTC_USD_FEED_ID]);
          return updateBytes;
        },
      },
      pythClient: {
        async updatePriceFeeds(gotTx, gotUpdates, gotIds) {
          expect(gotTx).toBe(tx);
          expect(gotUpdates).toBe(updateBytes);
          expect(gotIds).toEqual([PYTH_BTC_USD_FEED_ID]);
          return ['0xprice-info'];
        },
      },
    });

    expect(normalizePythFeedId(PYTH_BTC_USD_FEED_ID.slice(2))).toBe(PYTH_BTC_USD_FEED_ID);
    expect(priceInfoIds).toEqual(['0xprice-info']);
  });

  it('quotes secondary exits and NAV discount', () => {
    const quote = quoteConstantProductExit(100, { reserveIn: 10_000, reserveOut: 9_500, feeBps: 30 });
    expect(quote.amountOut).toBeGreaterThan(0);
    expect(quote.priceImpactPct).toBeGreaterThan(0);
    expect(navDiscountPct(1, 0.95)).toBeCloseTo(-5);
  });

  it('hashes, stores, and fetches Walrus note specs through HTTP adapters', async () => {
    const payload = { name: 'Range Coupon', strategy: 'fixed_coupon_range', target: { g: [0, 1] } };
    expect(hashWalrusPayload(payload)).toBe(hashWalrusPayload({ target: { g: [0, 1] }, strategy: 'fixed_coupon_range', name: 'Range Coupon' }));

    const put = await putWalrusJson('https://walrus.example/v1/blobs', payload, async () => {
      return new Response(JSON.stringify({ blobId: 'blob', hash: 'hash' }), { status: 200 });
    });
    expect(put).toEqual({ blobId: 'blob', hash: 'hash' });

    const got = await getWalrusJson<typeof payload>('https://walrus.example/v1/blobs', 'blob', async (url) => {
      expect(String(url)).toBe('https://walrus.example/v1/blobs/blob');
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    expect(got.name).toBe(payload.name);
  });

  it('caps builder fees and ranks publisher volume', () => {
    expect(builderFee(1_000_000, 10)).toBe(1_000);
    expect(() => builderFee(1_000_000, 11)).toThrow(/cap/i);
    expect(
      rankPublishers([
        { publisher: 'alice', volume: 100, realizedPayout: 50 },
        { publisher: 'bob', volume: 200, realizedPayout: 10 },
        { publisher: 'alice', volume: 150, realizedPayout: 25 },
      ])[0].publisher,
    ).toBe('alice');
  });

  it('caps fee-eligible publisher volume for new strategists', () => {
    expect(capacityCappedBuilderFee(1_000_000, 10, 900_000, 1_000_000)).toEqual({
      eligibleVolume: 100_000,
      fee: 100,
      remainingCapacity: 0,
    });
    expect(capacityCappedBuilderFee(1_000_000, 10, 1_500_000, 1_000_000).fee).toBe(0);
  });
});
