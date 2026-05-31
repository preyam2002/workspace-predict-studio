import { createHash } from 'node:crypto';

export const WALRUS_TESTNET_PUBLISHER = 'https://publisher.walrus-testnet.walrus.space';
export const WALRUS_TESTNET_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

export interface WalrusBlobRef {
  blobId: string;
  hash: string;
}

export interface WalrusNoteSpec {
  name: string;
  strategy: string;
  target: unknown;
  backtest?: unknown;
  createdAt?: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function walrusBlobCollection(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, '');
  return trimmed.endsWith('/v1/blobs') ? trimmed : `${trimmed}/v1/blobs`;
}

export function hashWalrusPayload(payload: unknown): string {
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

export async function putWalrusJson(
  publisher: string,
  payload: WalrusNoteSpec,
  fetcher: typeof fetch = fetch,
  epochs = 5,
): Promise<WalrusBlobRef> {
  const hash = hashWalrusPayload(payload);
  const body = stableJson(payload);
  const res = await fetcher(`${walrusBlobCollection(publisher)}?epochs=${epochs}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-content-sha256': hash },
    body,
  });
  if (!res.ok) throw new Error(`walrus put failed: ${res.status}`);
  const json = (await res.json()) as Partial<WalrusBlobRef> & {
    newlyCreated?: { blobObject?: { blobId?: string } };
    alreadyCertified?: { blobId?: string };
  };
  const blobId = json.blobId ?? json.newlyCreated?.blobObject?.blobId ?? json.alreadyCertified?.blobId;
  if (!blobId) throw new Error('walrus put response missing blobId');
  return { blobId, hash: json.hash ?? hash };
}

export async function getWalrusJson<T>(aggregator: string, blobId: string, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${walrusBlobCollection(aggregator)}/${blobId}`);
  if (!res.ok) throw new Error(`walrus get failed: ${res.status}`);
  return res.json() as Promise<T>;
}
