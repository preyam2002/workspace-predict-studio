import { describe, expect, it } from 'vitest';
import { navDiscountPct, quoteConstantProductExit } from './cetus';
import { builderFee, capacityCappedBuilderFee, rankPublishers } from './creator';
import { buildSponsoredTransactionRequest, requestSponsoredTransaction, sponsorConfigFromEnv } from './enoki';
import { pythNavAnchor } from './pyth';
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

  it('normalizes Pyth prices and flags stale anchors', () => {
    const fresh = pythNavAnchor({ price: '7012345678900', expo: -8, publishTime: 100 }, 120);
    expect(fresh.price).toBeCloseTo(70_123.456789);
    expect(fresh.stale).toBe(false);
    expect(pythNavAnchor({ price: '1', expo: 0, publishTime: 1 }, 120).stale).toBe(true);
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
