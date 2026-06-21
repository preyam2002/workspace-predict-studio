import { buildCatalogTarget, catalogProducts, type CatalogProductId } from './catalog';
import { snapStrike } from './decompose';
import { solveSparse } from './solver';
import type { OracleState, SparseSolution, SparseTarget } from './types';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

const catalogIds = catalogProducts.map((product) => product.id);

export interface IntentRegion {
  loUsd: number | null;
  hiUsd: number | null;
  payoffUsd: number;
}

export type IntentSpec =
  | {
      kind: 'catalog';
      catalogId: CatalogProductId;
      payoffUsd: number;
      summary: string;
    }
  | {
      kind: 'regions';
      regions: IntentRegion[];
      summary: string;
    };

export interface IntentResult {
  spec: IntentSpec;
  target: SparseTarget;
  solution: SparseSolution;
  echo: string;
  source?: 'anthropic' | 'deterministic';
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const intentToolInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'summary'],
  properties: {
    kind: { type: 'string', enum: ['catalog', 'regions'] },
    summary: { type: 'string', minLength: 6, maxLength: 180 },
    catalogId: { type: 'string', enum: catalogIds },
    payoffUsd: { type: 'number', minimum: 0 },
    regions: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['loUsd', 'hiUsd', 'payoffUsd'],
        properties: {
          loUsd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          hiUsd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          payoffUsd: { type: 'number', minimum: 0 },
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function summaryOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 6) throw new Error('summary is required');
  return value.trim().slice(0, 180);
}

function normalizeCatalogId(value: unknown): CatalogProductId {
  if (typeof value !== 'string' || !catalogIds.includes(value as CatalogProductId)) throw new Error('catalogId is not supported');
  return value as CatalogProductId;
}

function normalizeCatalogPayoff(value: unknown): number {
  if (value === undefined || value === null) return 100;
  const payoffUsd = assertFiniteNumber(value, 'payoffUsd');
  if (payoffUsd < 0) throw new Error('payoffUsd must be non-negative');
  return payoffUsd;
}

function normalizeRegion(input: unknown, index: number): IntentRegion {
  if (!isRecord(input)) throw new Error(`region ${index + 1} must be an object`);
  const loUsd = input.loUsd === null ? null : assertFiniteNumber(input.loUsd, `region ${index + 1} loUsd`);
  const hiUsd = input.hiUsd === null ? null : assertFiniteNumber(input.hiUsd, `region ${index + 1} hiUsd`);
  const payoffUsd = assertFiniteNumber(input.payoffUsd, `region ${index + 1} payoffUsd`);
  if (payoffUsd < 0) throw new Error('payoff regions must be non-negative');
  if (loUsd === null && hiUsd === null) throw new Error(`region ${index + 1} needs at least one boundary`);
  if (loUsd !== null && hiUsd !== null && loUsd >= hiUsd) throw new Error(`region ${index + 1} lower boundary must be below upper boundary`);
  return { loUsd, hiUsd, payoffUsd };
}

export function normalizeIntentSpec(input: unknown): IntentSpec {
  if (!isRecord(input)) throw new Error('intent spec must be an object');
  const kind = input.kind;
  const summary = summaryOf(input.summary);

  if (kind === 'catalog') {
    return { kind, catalogId: normalizeCatalogId(input.catalogId), payoffUsd: normalizeCatalogPayoff(input.payoffUsd), summary };
  }

  if (kind === 'regions') {
    if (!Array.isArray(input.regions) || input.regions.length === 0 || input.regions.length > 8) {
      throw new Error('regions must contain 1-8 payoff regions');
    }
    return { kind, summary, regions: input.regions.map(normalizeRegion) };
  }

  throw new Error('kind must be catalog or regions');
}

function strikeScale(oracle: Pick<OracleState, 'forward'>): number {
  return Math.abs(oracle.forward) > 1_000_000 ? 1_000_000_000 : 1;
}

function strikeFromUsd(value: number | null, oracle: Pick<OracleState, 'forward' | 'minStrike' | 'tickSize' | 'maxStrike'>): number | null {
  if (value === null) return null;
  return snapStrike(value * strikeScale(oracle), oracle);
}

function sampleIntentGrid(
  oracle: Pick<OracleState, 'forward' | 'minStrike' | 'tickSize' | 'maxStrike'>,
  boundaries: number[] = [],
): number[] {
  const center = snapStrike(oracle.forward, oracle);
  // Resolution must be a meaningful fraction of the forward, not the raw tick:
  // testnet oracles can carry a ~$1 tick against a ~$64k strike, which would
  // otherwise collapse the grid to a few dollars wide and silently discard the
  // user's strike. Step up to ~2% of forward while staying tick-aligned.
  const step = Math.max(oracle.tickSize, Math.round((oracle.forward * 0.02) / oracle.tickSize) * oracle.tickSize);
  const marks = [center, ...boundaries.map((b) => snapStrike(b, oracle))];
  const lo = Math.min(...marks) - 2 * step;
  const hi = Math.max(...marks) + 2 * step;
  const grid = new Set<number>();
  // Dense band around the forward for payoff-curve shape...
  for (let i = -8; i <= 8; i += 1) grid.add(snapStrike(center + i * step, oracle));
  // ...extended to cover every region boundary so the typed strike is in range...
  for (let s = lo; s <= hi; s += step) grid.add(snapStrike(s, oracle));
  // ...and the exact boundaries pinned as nodes so the step lands on the strike.
  for (const b of boundaries) grid.add(snapStrike(b, oracle));
  return [...grid].sort((a, b) => a - b);
}

function regionPays(region: IntentRegion, strike: number, oracle: OracleState): boolean {
  const lo = strikeFromUsd(region.loUsd, oracle);
  const hi = strikeFromUsd(region.hiUsd, oracle);
  if (lo === null && hi !== null) return strike < hi;
  if (hi === null && lo !== null) return strike > lo;
  return lo !== null && hi !== null && strike > lo && strike <= hi;
}

export function buildIntentTarget(spec: IntentSpec, oracle: OracleState): SparseTarget {
  if (spec.kind === 'catalog') {
    const target = buildCatalogTarget(spec.catalogId, oracle);
    const maxTarget = Math.max(0, ...target.g);
    const scale = maxTarget > 0 ? spec.payoffUsd / maxTarget : 0;
    return { ...target, g: target.g.map((value) => value * scale) };
  }

  const boundaries = spec.regions
    .flatMap((region) => [region.loUsd, region.hiUsd])
    .filter((value): value is number => value !== null)
    .map((usd) => usd * strikeScale(oracle));
  const gridStrikes = sampleIntentGrid(oracle, boundaries);
  return {
    gridStrikes,
    g: gridStrikes.map((strike) => spec.regions.reduce((sum, region) => sum + (regionPays(region, strike, oracle) ? region.payoffUsd : 0), 0)),
  };
}

export function validateIntentSpec(input: unknown, oracle: OracleState): IntentResult {
  const spec = normalizeIntentSpec(input);
  const target = buildIntentTarget(spec, oracle);
  if (target.g.some((value) => value < 0)) throw new Error('target payoff must be non-negative');
  const solution = solveSparse(target, { maxLegs: 8, tol: 0.01 });
  if (solution.legCount > 8 || solution.maxAbsError > 0.01) throw new Error('intent payoff does not replicate within the 8-leg cap');
  return { spec, target, solution, echo: spec.summary };
}

function parseNumberToken(raw: string, suffix = ''): number {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) throw new Error(`Invalid number: ${raw}`);
  const unit = suffix.toLowerCase();
  if (unit === 'k') return value * 1_000;
  if (unit === 'm') return value * 1_000_000;
  return value;
}

function moneyTokenPattern() {
  return String.raw`\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kKmM]?)`;
}

function parsePayoffUsd(prompt: string): number {
  const keyword = new RegExp(String.raw`(?:max\s+gain|gross\s+payout|payout|payoff|pay)\D{0,18}${moneyTokenPattern()}`, 'i');
  const match = prompt.match(keyword);
  if (!match) return 100;
  return Math.max(0, parseNumberToken(match[1], match[2]));
}

function usdLabel(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fallbackRange(oracle: OracleState, payoffUsd: number): IntentSpec {
  const scale = strikeScale(oracle);
  const forwardUsd = oracle.forward / scale;
  const loUsd = Math.round(forwardUsd * 0.95);
  const hiUsd = Math.round(forwardUsd * 1.05);
  return {
    kind: 'regions',
    summary: `${oracle.underlyingAsset} pays ${usdLabel(payoffUsd)} between ${usdLabel(loUsd)} and ${usdLabel(hiUsd)} at expiry`,
    regions: [{ loUsd, hiUsd, payoffUsd }],
  };
}

export function createIntentFallback({ prompt, oracle }: { prompt: string; oracle: OracleState }): IntentResult {
  const text = prompt.trim();
  const payoffUsd = parsePayoffUsd(text);
  const between = text.match(new RegExp(String.raw`between\s+${moneyTokenPattern()}\s*(?:and|to|-)\s*${moneyTokenPattern()}`, 'i'));
  if (between) {
    const loUsd = parseNumberToken(between[1], between[2]);
    const hiUsd = parseNumberToken(between[3], between[4]);
    const result = validateIntentSpec(
      {
        kind: 'regions',
        summary: `${oracle.underlyingAsset} pays ${usdLabel(payoffUsd)} between ${usdLabel(loUsd)} and ${usdLabel(hiUsd)} at expiry`,
        regions: [{ loUsd, hiUsd, payoffUsd }],
      },
      oracle,
    );
    return { ...result, source: 'deterministic' };
  }

  const above = text.match(new RegExp(String.raw`(?:above|over|greater\s+than|to)\s+${moneyTokenPattern()}`, 'i'));
  if (above) {
    const loUsd = parseNumberToken(above[1], above[2]);
    const result = validateIntentSpec(
      {
        kind: 'regions',
        summary: `${oracle.underlyingAsset} pays ${usdLabel(payoffUsd)} above ${usdLabel(loUsd)} at expiry`,
        regions: [{ loUsd, hiUsd: null, payoffUsd }],
      },
      oracle,
    );
    return { ...result, source: 'deterministic' };
  }

  const below = text.match(new RegExp(String.raw`(?:below|under|less\s+than)\s+${moneyTokenPattern()}`, 'i'));
  if (below) {
    const hiUsd = parseNumberToken(below[1], below[2]);
    const result = validateIntentSpec(
      {
        kind: 'regions',
        summary: `${oracle.underlyingAsset} pays ${usdLabel(payoffUsd)} below ${usdLabel(hiUsd)} at expiry`,
        regions: [{ loUsd: null, hiUsd, payoffUsd }],
      },
      oracle,
    );
    return { ...result, source: 'deterministic' };
  }

  return { ...validateIntentSpec(fallbackRange(oracle, payoffUsd), oracle), source: 'deterministic' };
}

function oracleContext(oracle: OracleState): string {
  const scale = strikeScale(oracle);
  return [
    `underlying=${oracle.underlyingAsset}`,
    `spotUsd=${oracle.spot / scale}`,
    `forwardUsd=${oracle.forward / scale}`,
    `minStrikeUsd=${oracle.minStrike / scale}`,
    `maxStrikeUsd=${oracle.maxStrike / scale}`,
    `tickSizeUsd=${oracle.tickSize / scale}`,
    `expiryMs=${oracle.expiryMs}`,
  ].join('\n');
}

function buildAnthropicBody(prompt: string, oracle: OracleState, model: string, validationError?: string) {
  const retryText = validationError ? `\nPrevious output failed validation: ${validationError}. Return a corrected tool call only.` : '';
  return {
    model,
    max_tokens: 900,
    system:
      'Convert a market view into one long-only structured note payoff. Use only the create_structured_note tool. ' +
      'The target payoff g is never negative at any settlement price, and the final replicated note must fit within 8 legs. ' +
      'CRITICAL: whenever the user names explicit price levels — e.g. "above $70k", "below $60k", "between $66k and $72k" — you MUST use kind "regions" with those exact USD numbers as loUsd/hiUsd, setting the unbounded side to null for a one-sided view. ' +
      'Catalog products are ATM-relative templates that ignore explicit strikes, so use kind "catalog" ONLY for a named shape with no explicit price level (e.g. "a strangle", "an upside note", "a range income note around spot"). ' +
      'For catalog outputs, set payoffUsd when the user specifies payout or max gain; otherwise use payoffUsd 100. For regions, set payoffUsd to the stated payout, or 100 if unstated.',
    tools: [
      {
        name: 'create_structured_note',
        description: 'Emit a constrained payoff DSL for Predict Studio.',
        input_schema: intentToolInputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'create_structured_note' },
    messages: [
      {
        role: 'user',
        content: `Market context:\n${oracleContext(oracle)}\n\nUser view:\n${prompt}${retryText}`,
      },
    ],
  };
}

function extractToolInput(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) throw new Error('Anthropic response missing content');
  const block = message.content.find((item) => isRecord(item) && item.type === 'tool_use' && item.name === 'create_structured_note');
  if (!isRecord(block)) throw new Error('Anthropic response missing create_structured_note tool use');
  return block.input;
}

export async function createIntentFromAnthropic({
  prompt,
  oracle,
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
  fetcher = fetch,
}: {
  prompt: string;
  oracle: OracleState;
  apiKey?: string;
  model?: string;
  fetcher?: FetchLike;
}): Promise<IntentResult> {
  if (!prompt.trim()) throw new Error('prompt is required');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required');

  let validationError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetcher(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildAnthropicBody(prompt.trim(), oracle, model, validationError || undefined)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic intent request failed: ${response.status} ${body}`.trim());
    }

    try {
      return { ...validateIntentSpec(extractToolInput(await response.json()), oracle), source: 'anthropic' };
    } catch (error) {
      validationError = error instanceof Error ? error.message : 'invalid tool input';
    }
  }

  throw new Error(`Anthropic intent failed validation: ${validationError}`);
}

export async function createIntentFromPrompt({
  prompt,
  oracle,
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
  fetcher = fetch,
}: {
  prompt: string;
  oracle: OracleState;
  apiKey?: string;
  model?: string;
  fetcher?: FetchLike;
}): Promise<IntentResult> {
  if (!apiKey) return createIntentFallback({ prompt, oracle });
  try {
    return await createIntentFromAnthropic({ prompt, oracle, apiKey, model, fetcher });
  } catch {
    return createIntentFallback({ prompt, oracle });
  }
}
