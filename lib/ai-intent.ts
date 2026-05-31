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
    return { kind, catalogId: normalizeCatalogId(input.catalogId), summary };
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

function sampleIntentGrid(oracle: Pick<OracleState, 'forward' | 'minStrike' | 'tickSize' | 'maxStrike'>): number[] {
  const center = snapStrike(oracle.forward, oracle);
  const out: number[] = [];
  for (let i = -6; i <= 6; i += 1) out.push(snapStrike(center + i * oracle.tickSize, oracle));
  return [...new Set(out)].sort((a, b) => a - b);
}

function regionPays(region: IntentRegion, strike: number, oracle: OracleState): boolean {
  const lo = strikeFromUsd(region.loUsd, oracle);
  const hi = strikeFromUsd(region.hiUsd, oracle);
  if (lo === null && hi !== null) return strike < hi;
  if (hi === null && lo !== null) return strike > lo;
  return lo !== null && hi !== null && strike > lo && strike <= hi;
}

export function buildIntentTarget(spec: IntentSpec, oracle: OracleState): SparseTarget {
  if (spec.kind === 'catalog') return buildCatalogTarget(spec.catalogId, oracle);

  const gridStrikes = sampleIntentGrid(oracle);
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
      'All payoffs must be non-negative at every settlement price. Prefer catalog when the view matches a named product; use regions for simple ranges or one-sided views.',
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
      return validateIntentSpec(extractToolInput(await response.json()), oracle);
    } catch (error) {
      validationError = error instanceof Error ? error.message : 'invalid tool input';
    }
  }

  throw new Error(`Anthropic intent failed validation: ${validationError}`);
}
