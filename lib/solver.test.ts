import { describe, expect, it } from 'vitest';
import {
  buildDictionary,
  certifyGap,
  nnls,
  priceSolution,
  solveBranchAndBound,
  solveCertifiedSparse,
  solveExact,
  solveSparse,
} from './solver';
import type { SparseTarget, SVI } from './types';

describe('nnls', () => {
  it('recovers exact non-negative weights on an orthogonal system', () => {
    const cols = [Float64Array.from([1, 1, 0, 0]), Float64Array.from([0, 0, 1, 1])];
    const g = Float64Array.from([3, 3, 5, 5]);
    const w = Float64Array.from([1, 1, 1, 1]);
    const x = nnls(cols, g, w);
    expect(x[0]).toBeCloseTo(3, 4);
    expect(x[1]).toBeCloseTo(5, 4);
  });

  it('never returns a negative coefficient', () => {
    const cols = [Float64Array.from([1, 1, 1])];
    const g = Float64Array.from([-2, -2, -2]);
    const w = Float64Array.from([1, 1, 1]);
    const x = nnls(cols, g, w);
    expect(x[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('buildDictionary', () => {
  it('includes up, down, and range atoms over the grid', () => {
    const strikes = [100, 110, 120, 130];
    const dict = buildDictionary(strikes);

    for (const atom of dict) {
      expect(atom.payoff.length).toBe(4);
      for (const v of atom.payoff) expect(v === 0 || v === 1).toBe(true);
    }

    const upLow = dict.find((d) => d.leg.isUp && !d.leg.isRange && d.leg.lowerStrike === 100);
    const downHigh = dict.find((d) => !d.leg.isUp && !d.leg.isRange && d.leg.lowerStrike === 130);
    const rangeAtom = dict.find((d) => d.leg.isRange && d.leg.lowerStrike === 100 && d.leg.higherStrike === 120);
    expect(upLow).toBeDefined();
    expect(downHigh).toBeDefined();
    expect(rangeAtom).toBeDefined();
  });
});

describe('solveSparse', () => {
  const strikes = [90, 100, 110, 120, 130, 140];

  it('recovers a single range bet exactly with 1 leg', () => {
    const g = strikes.map((s) => (s > 110 && s <= 130 ? 1 : 0));
    const target: SparseTarget = { gridStrikes: strikes, g };
    const sol = solveSparse(target, { maxLegs: 8, tol: 1e-6 });
    expect(sol.legCount).toBe(1);
    expect(sol.maxAbsError).toBeLessThan(1e-6);
  });

  it('fits a monotone bull ramp within tolerance under the leg cap', () => {
    const g = strikes.map((s) => Math.max(0, Math.min(3, (s - 100) / 10)));
    const sol = solveSparse({ gridStrikes: strikes, g }, { maxLegs: 8, tol: 0.05 });
    expect(sol.legCount).toBeLessThanOrEqual(8);
    expect(sol.l2Error).toBeLessThanOrEqual(0.05);
    expect(sol.legs.every((l) => l.quantity >= 0)).toBe(true);
  });

  it('respects a hard leg budget even if error stays above tolerance', () => {
    const g = strikes.map((_, i) => i % 2);
    const sol = solveSparse({ gridStrikes: strikes, g }, { maxLegs: 3, tol: 1e-9 });
    expect(sol.legCount).toBeLessThanOrEqual(3);
  });

  it('rejects negative targets', () => {
    const g = strikes.map(() => -1);
    expect(() => solveSparse({ gridStrikes: strikes, g }, { maxLegs: 8, tol: 0.01 })).toThrow(/non-negative/i);
  });
});

describe('priceSolution', () => {
  it('prices a solution as sum of leg probabilities times quantity', () => {
    const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };
    const sol = solveSparse({ gridStrikes: [90, 100, 110, 120], g: [0, 0, 1, 1] }, { maxLegs: 4, tol: 1e-6 });
    const priced = priceSolution(sol, svi, 100_000);
    expect(priced.premiumEst).toBeGreaterThan(0);
    expect(priced.premiumEst).toBeLessThanOrEqual(1);
  });
});

describe('exact sparse solving and certification', () => {
  const target: SparseTarget = {
    gridStrikes: [90, 100, 110, 120],
    g: [1, 0, 1, 0],
  };

  it('finds an exact solution no worse than NNOMP on small dictionaries', () => {
    const greedy = solveSparse(target, { maxLegs: 2, tol: 0.001, maxMacroWidth: 2 });
    const exact = solveExact(target, { maxLegs: 2, tol: 0.001, maxMacroWidth: 2 });
    expect(exact.l2Error).toBeLessThanOrEqual(greedy.l2Error + 1e-9);
    expect(exact.legCount).toBeLessThanOrEqual(2);
  });

  it('branch-and-bound matches exhaustive exact solving when the node budget covers the search', () => {
    const exact = solveExact(target, { maxLegs: 2, tol: 0.001, maxMacroWidth: 2 });
    const bnb = solveBranchAndBound(target, { maxLegs: 2, tol: 0.001, maxMacroWidth: 2, maxNodes: 50_000 });
    expect(bnb.l2Error).toBeCloseTo(exact.l2Error, 9);
  });

  it('returns a coherence certificate and a certified-or-exact solution', () => {
    const cert = certifyGap(target, 2, { maxMacroWidth: 2 });
    expect(cert.coherence).toBeGreaterThanOrEqual(0);
    expect(typeof cert.exactRecovery).toBe('boolean');
    expect(cert.gapBound).toBeGreaterThanOrEqual(0);

    const res = solveCertifiedSparse(target, { maxLegs: 2, tol: 0.001, maxMacroWidth: 2 });
    expect(res.solution.legCount).toBeLessThanOrEqual(2);
    expect(res.certificate.coherence).toBe(cert.coherence);
  });
});
