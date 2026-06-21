import { describe, expect, it } from 'vitest';
import {
  buildCreateCetusPoolWithPriceTx,
  cetusMarketConfigFromEnv,
  navDiscountPct,
  quoteConstantProductExit,
  readCetusSecondaryPrice,
  unconfiguredCetusSecondaryMarket,
  verifyCetusDeployment,
} from './cetus';
import { builderFee, capacityCappedBuilderFee, rankPublishers } from './creator';
import { buildSponsoredTransactionRequest, enokiAuthProvidersFromEnv, requestSponsoredTransaction, sponsorConfigFromEnv } from './enoki';
import {
  PYTH_BTC_USD_FEED_ID,
  buildPythPriceFeedUpdate,
  fetchPythNavAnchor,
  normalizePythFeedId,
  pythNavAnchor,
} from './pyth';
import { WALRUS_TESTNET_AGGREGATOR, WALRUS_TESTNET_PUBLISHER, getWalrusJson, hashWalrusPayload, putWalrusJson } from './walrus';

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

  it('builds Cetus market config from public env and reports missing config without a mock price', () => {
    expect(cetusMarketConfigFromEnv({})).toBeUndefined();
    expect(
      cetusMarketConfigFromEnv({
        NEXT_PUBLIC_CETUS_STUDIO_POOL_ID: '0xpool',
        NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE: '0xstudio',
        NEXT_PUBLIC_DUSDC_TYPE: '0xd::dusdc::DUSDC',
        NEXT_PUBLIC_SUI_NETWORK: 'testnet',
      }),
    ).toEqual({
      poolId: '0xpool',
      baseCoinType: '0xstudio::studio_lp::STUDIO_LP',
      quoteCoinType: '0xd::dusdc::DUSDC',
      baseDecimals: 6,
      quoteDecimals: 6,
      env: 'testnet',
    });
    expect(unconfiguredCetusSecondaryMarket()).toEqual({
      source: 'unconfigured',
      reason: 'missing STUDIO_LP/dUSDC Cetus pool config',
    });
  });

  it('verifies Cetus testnet deployment from SDK config and a sample pool', async () => {
    const status = await verifyCetusDeployment({
      sdkOptions: {
        env: 'testnet',
        clmm_pool: { package_id: '0xclmm', published_at: '0xpublished' },
      },
      Pool: {
        async getPoolsWithPage(args) {
          expect(args).toEqual({ limit: 1 });
          return { data: [{ id: '0xpool' }], hasNextPage: false };
        },
      },
    });

    expect(status).toEqual({
      deployed: true,
      env: 'testnet',
      packageId: '0xclmm',
      publishedAt: '0xpublished',
      samplePoolId: '0xpool',
    });
  });

  it('reads a Cetus secondary price and orients it as quote per STUDIO LP', async () => {
    const price = await readCetusSecondaryPrice(
      {
        poolId: '0xpool',
        baseCoinType: '0xstudio::studio_lp::STUDIO_LP',
        quoteCoinType: '0xd::dusdc::DUSDC',
        baseDecimals: 6,
        quoteDecimals: 6,
      },
      {
        Pool: {
          async getPool(poolId) {
            expect(poolId).toBe('0xpool');
            return {
              id: poolId,
              coin_type_a: '0xstudio::studio_lp::STUDIO_LP',
              coin_type_b: '0xd::dusdc::DUSDC',
              current_sqrt_price: '18446744073709551616',
              fee_rate: 3000,
            };
          },
        },
      },
    );

    expect(price).toMatchObject({
      poolId: '0xpool',
      source: 'cetus',
      coinTypeA: '0xstudio::studio_lp::STUDIO_LP',
      coinTypeB: '0xd::dusdc::DUSDC',
      feeRate: 3000,
    });
    expect(price.price).toBe(1);
  });

  it('inverts Cetus pool price when STUDIO LP is coin B', async () => {
    const price = await readCetusSecondaryPrice(
      {
        poolId: '0xpool',
        baseCoinType: '0xstudio::studio_lp::STUDIO_LP',
        quoteCoinType: '0xd::dusdc::DUSDC',
        baseDecimals: 6,
        quoteDecimals: 6,
      },
      {
        Pool: {
          async getPool() {
            return {
              id: '0xpool',
              coin_type_a: '0xd::dusdc::DUSDC',
              coin_type_b: '0xstudio::studio_lp::STUDIO_LP',
              current_sqrt_price: '18446744073709551616',
            };
          },
        },
      },
    );

    expect(price.price).toBe(1);
    expect(price.inverted).toBe(true);
  });

  it('builds a Cetus STUDIO LP/dUSDC create-pool payload through the SDK', async () => {
    const tx = {};
    const result = await buildCreateCetusPoolWithPriceTx(
      {
        coinTypeA: '0xstudio::studio_lp::STUDIO_LP',
        coinTypeB: '0xd::dusdc::DUSDC',
        tickSpacing: 20,
        currentPrice: '1',
        coinAmount: '1000000',
        fixAmountA: true,
        coinDecimalsA: 6,
        coinDecimalsB: 6,
        priceBaseCoin: 'coin_a',
        slippage: 0.05,
        fullRange: true,
      },
      {
        Pool: {
          async calculateCreatePoolWithPrice(params) {
            expect(params.add_mode_params).toEqual({ is_full_range: true });
            expect(params.current_price).toBe('1');
            return { calculated: true };
          },
          async createPoolWithPricePayload(params) {
            expect(params.calculate_result).toEqual({ calculated: true });
            expect(params.coin_type_a).toContain('STUDIO_LP');
            return tx;
          },
        },
      },
    );

    expect(result).toBe(tx);
  });

  it('hashes, stores, and fetches Walrus note specs through HTTP adapters', async () => {
    const payload = { name: 'Range Coupon', strategy: 'fixed_coupon_range', target: { g: [0, 1] } };
    expect(hashWalrusPayload(payload)).toBe(hashWalrusPayload({ target: { g: [0, 1] }, strategy: 'fixed_coupon_range', name: 'Range Coupon' }));

    const put = await putWalrusJson('https://publisher.example', payload, async (url, init) => {
      expect(String(url)).toBe('https://publisher.example/v1/blobs?epochs=5');
      expect(init?.method).toBe('PUT');
      expect(init?.headers).toEqual({ 'content-type': 'application/json', 'x-content-sha256': hashWalrusPayload(payload) });
      return new Response(JSON.stringify({ newlyCreated: { blobObject: { blobId: 'blob' } } }), { status: 200 });
    });
    expect(put).toEqual({ blobId: 'blob', hash: hashWalrusPayload(payload) });

    const certified = await putWalrusJson('https://publisher.example', payload, async () => {
      return new Response(JSON.stringify({ alreadyCertified: { blobId: 'existing' } }), { status: 200 });
    });
    expect(certified.blobId).toBe('existing');

    const got = await getWalrusJson<typeof payload>('https://aggregator.example', 'blob', async (url) => {
      expect(String(url)).toBe('https://aggregator.example/v1/blobs/blob');
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    expect(got.name).toBe(payload.name);
    expect(WALRUS_TESTNET_PUBLISHER).toContain('publisher.walrus-testnet');
    expect(WALRUS_TESTNET_AGGREGATOR).toContain('aggregator.walrus-testnet');
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
