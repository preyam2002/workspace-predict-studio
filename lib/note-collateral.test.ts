import { describe, expect, it } from 'vitest';
import { noteBorrowTerms } from './note-collateral';

describe('noteBorrowTerms', () => {
  it('lends ltv * min(mark, ceiling), never above the provable ceiling', () => {
    const t = noteBorrowTerms({ markedValue: 45_000, maxPayout: 100_000, ltvBps: 5_000 });
    expect(t.provableFloor).toBe(0);
    expect(t.provableCeiling).toBe(100_000);
    expect(t.collateralValue).toBe(45_000); // mark < ceiling
    expect(t.capacity).toBe(22_500); // 50% of 45k
  });

  it('clamps the collateral basis to the ceiling when the mark exceeds max_payout', () => {
    const t = noteBorrowTerms({ markedValue: 120_000, maxPayout: 100_000, ltvBps: 5_000 });
    expect(t.collateralValue).toBe(100_000);
    expect(t.capacity).toBe(50_000);
    // Capacity can never exceed ltv * ceiling — the ungameable bound.
    expect(t.capacity).toBeLessThanOrEqual((t.provableCeiling * t.ltvBps) / 10_000);
  });

  it('a worthless mark yields zero capacity (floor is 0, not max_payout)', () => {
    const t = noteBorrowTerms({ markedValue: 0, maxPayout: 100_000, ltvBps: 5_000 });
    expect(t.capacity).toBe(0);
  });
});
