import { createHash } from 'node:crypto';

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

export function hashWalrusPayload(payload: unknown): string {
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

export async function putWalrusJson(endpoint: string, payload: WalrusNoteSpec, fetcher: typeof fetch = fetch): Promise<WalrusBlobRef> {
  const hash = hashWalrusPayload(payload);
  const res = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-content-sha256': hash },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`walrus put failed: ${res.status}`);
  const json = (await res.json()) as Partial<WalrusBlobRef> & { newlyCreated?: { blobObject?: { blobId?: string } } };
  const blobId = json.blobId ?? json.newlyCreated?.blobObject?.blobId;
  if (!blobId) throw new Error('walrus put response missing blobId');
  return { blobId, hash: json.hash ?? hash };
}

export async function getWalrusJson<T>(endpoint: string, blobId: string, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${endpoint.replace(/\/$/, '')}/${blobId}`);
  if (!res.ok) throw new Error(`walrus get failed: ${res.status}`);
  return res.json() as Promise<T>;
}
