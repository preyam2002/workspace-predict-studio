import type { WalrusNoteSpec } from './walrus';
import type { SparseTarget, StructureQuote } from './types';

export interface ShareableNote {
  v: 1;
  echo: string;
  target: SparseTarget;
  premium?: number;
  maxGain?: number;
  blobId?: string;
  hash?: string;
  createdAt: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 =
    typeof Buffer === 'undefined'
      ? btoa(String.fromCharCode(...bytes))
      : Buffer.from(bytes).toString('base64');
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  if (typeof Buffer === 'undefined') {
    return Uint8Array.from(
      atob(padded)
        .split('')
        .map((char) => char.charCodeAt(0)),
    );
  }
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

function assertTarget(value: unknown): SparseTarget {
  const target = value as Partial<SparseTarget> | undefined;
  if (!target || !Array.isArray(target.gridStrikes) || !Array.isArray(target.g)) {
    throw new Error('invalid shareable note target');
  }
  if (target.gridStrikes.length !== target.g.length || target.gridStrikes.length === 0) {
    throw new Error('invalid shareable note target');
  }
  return {
    gridStrikes: target.gridStrikes.map(Number),
    g: target.g.map(Number),
  };
}

export function shareableNoteFromQuote({
  echo,
  target,
  quote,
  blobId,
  hash,
  createdAt = new Date().toISOString(),
}: {
  echo: string;
  target: SparseTarget;
  quote?: Pick<StructureQuote, 'totalCost' | 'maxGain'>;
  blobId?: string;
  hash?: string;
  createdAt?: string;
}): ShareableNote {
  return {
    v: 1,
    echo: echo.trim().slice(0, 180),
    target,
    premium: quote?.totalCost,
    maxGain: quote?.maxGain,
    blobId,
    hash,
    createdAt,
  };
}

export function encodeShareableNote(note: ShareableNote): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(note)));
}

export function decodeShareableNote(value: string): ShareableNote {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<ShareableNote>;
    if (parsed.v !== 1 || typeof parsed.echo !== 'string' || typeof parsed.createdAt !== 'string') {
      throw new Error('invalid shareable note');
    }
    return {
      v: 1,
      echo: parsed.echo,
      target: assertTarget(parsed.target),
      premium: typeof parsed.premium === 'number' ? parsed.premium : undefined,
      maxGain: typeof parsed.maxGain === 'number' ? parsed.maxGain : undefined,
      blobId: typeof parsed.blobId === 'string' ? parsed.blobId : undefined,
      hash: typeof parsed.hash === 'string' ? parsed.hash : undefined,
      createdAt: parsed.createdAt,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('invalid shareable note')) throw error;
    throw new Error('invalid shareable note');
  }
}

export function buildShareableBuyUrl(note: ShareableNote, origin = ''): string {
  return `${origin}/buy?note=${encodeShareableNote(note)}`;
}

export function walrusSpecForShareableNote(note: ShareableNote): WalrusNoteSpec {
  return {
    name: note.echo,
    strategy: 'ai_intent',
    target: note.target,
    createdAt: note.createdAt,
  };
}
