import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MESSAGES_URL,
  DEFAULT_ANTHROPIC_MODEL,
  createIntentFallback,
  createIntentFromAnthropic,
  createIntentFromPrompt,
  intentToolInputSchema,
  validateIntentSpec,
  type FetchLike,
} from './ai-intent';
import type { OracleState } from './types';

const oracle: OracleState = {
  predictId: '0x1',
  oracleId: '0x2',
  dbpPackage: '0xdbp',
  dusdcType: '0xd::dusdc::DUSDC',
  expiryMs: 1,
  nowMs: 0,
  spot: 100,
  forward: 100,
  status: 'active',
  underlyingAsset: 'BTC',
  svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 },
  minStrike: 70,
  tickSize: 5,
  maxStrike: 130,
};

describe('ai intent DSL', () => {
  it('validates catalog fixtures into targets that solve under the PTB cap', () => {
    const result = validateIntentSpec(
      {
        kind: 'catalog',
        catalogId: 'fixed_coupon_range',
        summary: 'Range income note around spot',
      },
      oracle,
    );

    expect(result.spec.kind).toBe('catalog');
    expect(result.target.g.every((value) => value >= 0)).toBe(true);
    expect(Math.max(...result.target.g)).toBe(100);
    expect(result.solution.legCount).toBeLessThanOrEqual(8);
    expect(result.solution.maxAbsError).toBeLessThanOrEqual(0.01);
  });

  it('scales catalog intents to explicit payoff dollars when provided', () => {
    const result = validateIntentSpec(
      {
        kind: 'catalog',
        catalogId: 'capped_bull_note',
        payoffUsd: 250,
        summary: 'BTC upside note with 250 dollar payout',
      },
      oracle,
    );

    expect(Math.max(...result.target.g)).toBe(250);
  });

  it('normalizes additive USD payoff regions and rejects negative regions', () => {
    const scaledOracle = {
      ...oracle,
      spot: 100_000_000_000,
      forward: 100_000_000_000,
      minStrike: 70_000_000_000,
      tickSize: 5_000_000_000,
      maxStrike: 130_000_000_000,
    };
    const result = validateIntentSpec(
      {
        kind: 'regions',
        summary: 'Pays if BTC stays in a 90-110k range',
        regions: [{ loUsd: 90, hiUsd: 110, payoffUsd: 1 }],
      },
      scaledOracle,
    );

    const center = result.target.gridStrikes.indexOf(100_000_000_000);
    const low = result.target.gridStrikes.indexOf(80_000_000_000);
    expect(result.spec.kind).toBe('regions');
    expect(result.target.g[center]).toBe(1);
    expect(result.target.g[low]).toBe(0);
    expect(result.solution.legCount).toBeLessThanOrEqual(8);

    expect(() =>
      validateIntentSpec(
        {
          kind: 'regions',
          summary: 'Invalid short payoff',
          regions: [{ loUsd: null, hiUsd: 100, payoffUsd: -1 }],
        },
        oracle,
      ),
    ).toThrow(/non-negative/i);
  });

  it('calls Anthropic with forced tool output and retries invalid tool inputs', async () => {
    const calls: unknown[] = [];
    const fetcher: FetchLike = async (url, init) => {
      expect(url).toBe(ANTHROPIC_MESSAGES_URL);
      calls.push(JSON.parse(String(init?.body)));
      const input =
        calls.length === 1
          ? { kind: 'regions', summary: 'Invalid first pass', regions: [{ loUsd: 90, hiUsd: 110, payoffUsd: -1 }] }
          : { kind: 'regions', summary: 'BTC range note', regions: [{ loUsd: 90, hiUsd: 110, payoffUsd: 1 }] };

      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'create_structured_note', input }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await createIntentFromAnthropic({
      prompt: 'BTC stays between 90 and 110 through expiry',
      oracle,
      apiKey: 'test-key',
      fetcher,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      model: DEFAULT_ANTHROPIC_MODEL,
      tool_choice: { type: 'tool', name: 'create_structured_note' },
      tools: [{ name: 'create_structured_note', input_schema: intentToolInputSchema }],
    });
    expect(String((calls[0] as { system?: string }).system)).toMatch(/never negative/i);
    expect(String((calls[0] as { system?: string }).system)).toMatch(/8 legs/i);
    expect(result.echo).toContain('BTC range note');
    expect(result.solution.legCount).toBeLessThanOrEqual(8);
  });

  it('builds a deterministic fallback range when Anthropic is unavailable', () => {
    const result = createIntentFallback({
      prompt: 'BTC stays between 90 and 110 through expiry and max gain $250',
      oracle,
    });

    expect(result.echo).toContain('between $90 and $110');
    expect(Math.max(...result.target.g)).toBe(250);
    expect(result.solution.legCount).toBeLessThanOrEqual(8);
  });

  it('falls back to deterministic parsing when the API key is missing', async () => {
    const result = await createIntentFromPrompt({
      prompt: 'BTC above 105, payout $200',
      oracle,
      apiKey: undefined,
      fetcher: async () => {
        throw new Error('should not call Anthropic without a key');
      },
    });

    expect(result.echo).toContain('above $105');
    expect(Math.max(...result.target.g)).toBe(200);
  });
});
