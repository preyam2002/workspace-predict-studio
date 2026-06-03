import { describe, expect, it } from 'vitest';
import {
  buildShareableBuyUrl,
  decodeShareableNote,
  encodeShareableNote,
  shareableNoteFromQuote,
  walrusSpecForShareableNote,
} from './shareable-note';
import type { SparseTarget, StructureQuote } from './types';

const target: SparseTarget = {
  gridStrikes: [90, 100, 110],
  g: [0, 1, 0],
};

const quote: StructureQuote = {
  legs: [{ isRange: true, isUp: false, lowerStrike: 90, higherStrike: 110, quantity: 1_000_000 }],
  totalCost: 250_000,
  maxLoss: 250_000,
  maxGain: 750_000,
  breakevens: [95],
  ev: 120_000,
  savingsVsNaive: 0,
};

describe('shareable notes', () => {
  it('round-trips a compact note payload for /buy links', () => {
    const note = shareableNoteFromQuote({
      echo: 'BTC range note',
      target,
      quote,
      createdAt: '2026-06-03T00:00:00.000Z',
    });
    const encoded = encodeShareableNote(note);
    const decoded = decodeShareableNote(encoded);

    expect(decoded).toEqual(note);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('builds a share URL and Walrus note spec from the same payload', () => {
    const note = shareableNoteFromQuote({
      echo: 'BTC range note',
      target,
      quote,
      blobId: 'blob',
      hash: 'hash',
      createdAt: '2026-06-03T00:00:00.000Z',
    });

    expect(buildShareableBuyUrl(note, 'https://predict.example')).toMatch(/^https:\/\/predict\.example\/buy\?note=/);
    expect(walrusSpecForShareableNote(note)).toEqual({
      name: 'BTC range note',
      strategy: 'ai_intent',
      target,
      createdAt: '2026-06-03T00:00:00.000Z',
    });
  });

  it('rejects invalid payloads instead of booting the buy lane with bad data', () => {
    expect(() => decodeShareableNote('not-json')).toThrow(/invalid shareable note/i);
  });
});
