import { describe, expect, it } from 'vitest';
import { detectButterflyViolation, gFunction, repairedDigitals, sviDerivs, sviW } from './arbfree';
import { priceRange, priceUp } from './payoff';
import type { SVI } from './types';

describe('svi arb-free primitives', () => {
  const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };

  it('computes w, w prime, and w double-prime analytically', () => {
    const { w, wpp } = sviDerivs(svi, 0.1);
    expect(w).toBeCloseTo(sviW(svi, 0.1), 12);
    expect(wpp).toBeGreaterThan(0);
  });

  it('g(k) is positive for a well-behaved slice', () => {
    for (let k = -1; k <= 1; k += 0.1) expect(gFunction(svi, k)).toBeGreaterThan(0);
  });
});

describe('butterfly violation detection and repair', () => {
  const benign: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };
  const bad: SVI = { a: 0.02, b: 5, rho: 0.99, m: 0, sigma: 0.05 };

  it('detects benign and pre-screen-invalid slices', () => {
    expect(detectButterflyViolation(benign, 1).ok).toBe(true);
    const check = detectButterflyViolation(bad, 1);
    expect(check.ok).toBe(false);
    expect(check.preScreenOk).toBe(false);
    expect(check.badIntervals.length).toBeGreaterThan(0);
  });

  it('repairs arb slices into bounded monotone digitals and non-negative ranges', () => {
    const strikes = [70, 80, 90, 100, 110, 120, 130];
    const repaired = repairedDigitals(bad, 100, strikes);
    for (let i = 0; i < repaired.length; i += 1) {
      expect(repaired[i].up).toBeGreaterThanOrEqual(0);
      expect(repaired[i].up).toBeLessThanOrEqual(1);
      if (i > 0) expect(repaired[i].up).toBeLessThanOrEqual(repaired[i - 1].up);
    }
  });

  it('routes priceUp and priceRange through the guard for invalid slices', () => {
    const lo = priceUp(bad, 100, 90);
    const hi = priceUp(bad, 100, 110);
    expect(lo).toBeGreaterThanOrEqual(hi);
    expect(priceRange(bad, 100, 90, 110)).toBeGreaterThanOrEqual(0);
  });
});
