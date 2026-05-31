import { down, range, up } from './decompose';
import { legPays, legProb } from './payoff';
import { USDC, type Leg, type SVI, type SparseSolution, type SparseTarget } from './types';

export interface Atom {
  leg: Leg;
  payoff: Float64Array;
}

export interface SolveOpts {
  maxLegs: number;
  tol: number;
  weights?: number[];
  coefFloor?: number;
  maxMacroWidth?: number;
}

export interface ExactSolveOpts extends SolveOpts {
  maxSupports?: number;
  coherencePrune?: number;
}

export interface GapCertificate {
  coherence: number;
  exactRecovery: boolean;
  gapBound: number;
  escalate: boolean;
}

function payoffVector(leg: Leg, strikes: number[]): Float64Array {
  return Float64Array.from(strikes.map((s) => (legPays(leg, s) ? 1 : 0)));
}

function weightedRms(residual: Float64Array, w: Float64Array): number {
  let err = 0;
  let den = 0;
  for (let t = 0; t < residual.length; t += 1) {
    err += (residual[t] * w[t]) ** 2;
    den += w[t] * w[t];
  }
  return Math.sqrt(err / Math.max(den, 1));
}

function weightsFor(n: number, weights?: number[]): Float64Array {
  return Float64Array.from(weights ?? new Array(n).fill(1)).map((v) => Math.sqrt(v));
}

function solutionFromSupport(
  target: SparseTarget,
  dict: Atom[],
  selected: number[],
  coef: ArrayLike<number>,
  w: Float64Array,
): SparseSolution {
  const legs = selected
    .map((j, r) => ({ ...dict[j].leg, quantity: Math.round(coef[r] * USDC) }))
    .filter((leg) => leg.quantity > 0);
  const residual = Float64Array.from(target.g);
  for (const leg of legs) {
    const qty = leg.quantity / USDC;
    const payoff = payoffVector(leg, target.gridStrikes);
    for (let t = 0; t < target.gridStrikes.length; t += 1) residual[t] -= qty * payoff[t];
  }

  let maxAbsError = 0;
  for (const v of residual) maxAbsError = Math.max(maxAbsError, Math.abs(v));

  return {
    legs,
    l2Error: weightedRms(residual, w),
    maxAbsError,
    premiumEst: 0,
    legCount: legs.length,
  };
}

function betterSolution(candidate: SparseSolution, best: SparseSolution): boolean {
  return (
    candidate.l2Error < best.l2Error - 1e-12 ||
    (Math.abs(candidate.l2Error - best.l2Error) <= 1e-12 && candidate.legCount < best.legCount) ||
    (Math.abs(candidate.l2Error - best.l2Error) <= 1e-12 &&
      candidate.legCount === best.legCount &&
      candidate.maxAbsError < best.maxAbsError)
  );
}

/**
 * Non-negative least squares via projected coordinate descent.
 * Solves min_x ||W^(1/2)(A x - g)||_2 subject to x >= 0, with A supplied as columns.
 */
export function nnls(cols: Float64Array[], g: Float64Array, w: Float64Array, iters = 300): Float64Array {
  const k = cols.length;
  const n = g.length;
  const x = new Float64Array(k);
  const r = Float64Array.from(g);
  const cc = cols.map((a) => {
    let s = 0;
    for (let t = 0; t < n; t += 1) s += w[t] * w[t] * a[t] * a[t];
    return s || 1;
  });

  for (let it = 0; it < iters; it += 1) {
    for (let j = 0; j < k; j += 1) {
      const a = cols[j];
      let num = 0;
      for (let t = 0; t < n; t += 1) num += w[t] * w[t] * a[t] * r[t];
      const xjNew = Math.max(0, x[j] + num / cc[j]);
      const d = xjNew - x[j];
      if (d !== 0) {
        for (let t = 0; t < n; t += 1) r[t] -= d * a[t];
        x[j] = xjNew;
      }
    }
  }

  return x;
}

/**
 * Dictionary atoms: up/down digitals at every node, plus contiguous range atoms.
 * Macro ranges are the gas win because one Predict range leg covers many cells.
 */
export function buildDictionary(strikes: number[], maxMacroWidth = 6): Atom[] {
  const atoms: Atom[] = [];
  const seen = new Set<string>();
  const push = (leg: Leg) => {
    const unitLeg = { ...leg, quantity: 1 };
    const payoff = payoffVector(unitLeg, strikes);
    if (!payoff.some((v) => v === 1)) return;

    const key = [unitLeg.isRange, unitLeg.isUp, unitLeg.lowerStrike, unitLeg.higherStrike].join(':');
    if (seen.has(key)) return;
    seen.add(key);
    atoms.push({ leg: unitLeg, payoff });
  };

  for (const k of strikes) {
    push(up(k, 1));
    push(down(k, 1));
  }

  for (let i = 0; i < strikes.length; i += 1) {
    for (let j = i + 1; j < Math.min(strikes.length, i + 1 + maxMacroWidth); j += 1) {
      push(range(strikes[i], strikes[j], 1));
    }
  }

  return atoms;
}

export function solveSparse(target: SparseTarget, opts: SolveOpts): SparseSolution {
  const { gridStrikes: strikes, g } = target;
  if (g.some((v) => v < -1e-9)) throw new Error('target must be non-negative (long-only constraint)');

  const n = strikes.length;
  const w = weightsFor(n, opts.weights);
  const coefFloor = opts.coefFloor ?? 1e-4;
  const dict = buildDictionary(strikes, opts.maxMacroWidth);
  const colNorm = dict.map((a) => {
    let s = 0;
    for (let t = 0; t < n; t += 1) s += a.payoff[t] * w[t] * w[t] * a.payoff[t];
    return Math.sqrt(s) || 1;
  });

  const target64 = Float64Array.from(g);
  let residual = Float64Array.from(g);
  let selected: number[] = [];
  let coef: number[] = [];

  for (let leg = 0; leg < opts.maxLegs; leg += 1) {
    let best = -1;
    let bestC = 1e-12;

    for (let j = 0; j < dict.length; j += 1) {
      if (selected.includes(j)) continue;
      let c = 0;
      for (let t = 0; t < n; t += 1) c += dict[j].payoff[t] * w[t] * w[t] * residual[t];
      c /= colNorm[j];
      if (c > bestC) {
        bestC = c;
        best = j;
      }
    }

    if (best === -1) break;
    selected.push(best);

    const x = nnls(
      selected.map((j) => dict[j].payoff),
      target64,
      w,
    );
    const keepIdx: number[] = [];
    const keepCoef: number[] = [];
    selected.forEach((j, r) => {
      if (x[r] > coefFloor) {
        keepIdx.push(j);
        keepCoef.push(x[r]);
      }
    });
    selected = keepIdx;
    coef = keepCoef;

    residual = Float64Array.from(g);
    selected.forEach((j, r) => {
      for (let t = 0; t < n; t += 1) residual[t] -= coef[r] * dict[j].payoff[t];
    });
    if (weightedRms(residual, w) <= opts.tol) break;
  }

  return solutionFromSupport(target, dict, selected, coef, w);
}

export function priceSolution(sol: SparseSolution, svi: SVI, forward: number): SparseSolution {
  const premiumEst = sol.legs.reduce((sum, leg) => sum + legProb(svi, forward, leg) * (leg.quantity / USDC), 0);
  return { ...sol, premiumEst };
}

function normalizedDot(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa === 0 || bb === 0 ? 0 : Math.abs(dot / Math.sqrt(aa * bb));
}

function pruneByCoherence(dict: Atom[], threshold: number): Atom[] {
  const out: Atom[] = [];
  for (const atom of dict) {
    if (!out.some((kept) => normalizedDot(atom.payoff, kept.payoff) > threshold)) out.push(atom);
  }
  return out;
}

function cappedCombinationCount(n: number, b: number, cap: number): number {
  let total = 1;
  let c = 1;
  for (let k = 1; k <= Math.min(n, b); k += 1) {
    c = (c * (n - k + 1)) / k;
    total += c;
    if (total > cap) return total;
  }
  return total;
}

export function solveExact(target: SparseTarget, opts: ExactSolveOpts): SparseSolution {
  if (target.g.some((v) => v < -1e-9)) throw new Error('target must be non-negative (long-only constraint)');
  const w = weightsFor(target.gridStrikes.length, opts.weights);
  const maxSupports = opts.maxSupports ?? 200_000;
  const dict = pruneByCoherence(buildDictionary(target.gridStrikes, opts.maxMacroWidth), opts.coherencePrune ?? 0.999999);
  const supportCount = cappedCombinationCount(dict.length, opts.maxLegs, maxSupports);
  if (supportCount > maxSupports) {
    throw new Error(`exact sparse solve support budget exceeded: ${supportCount} > ${maxSupports}`);
  }

  let best = solutionFromSupport(target, dict, [], [], w);
  const support: number[] = [];
  const target64 = Float64Array.from(target.g);

  const visit = (start: number) => {
    if (support.length > 0) {
      const x = nnls(
        support.map((j) => dict[j].payoff),
        target64,
        w,
      );
      const candidate = solutionFromSupport(target, dict, support, x, w);
      if (betterSolution(candidate, best)) best = candidate;
    }
    if (support.length >= opts.maxLegs) return;

    for (let j = start; j < dict.length; j += 1) {
      support.push(j);
      visit(j + 1);
      support.pop();
    }
  };

  visit(0);
  return best;
}

export function solveBranchAndBound(target: SparseTarget, opts: ExactSolveOpts & { maxNodes?: number }): SparseSolution {
  if (target.g.some((v) => v < -1e-9)) throw new Error('target must be non-negative (long-only constraint)');
  const w = weightsFor(target.gridStrikes.length, opts.weights);
  const dict = pruneByCoherence(buildDictionary(target.gridStrikes, opts.maxMacroWidth), opts.coherencePrune ?? 0.999999);
  const target64 = Float64Array.from(target.g);
  const maxNodes = opts.maxNodes ?? opts.maxSupports ?? 100_000;
  let nodes = 0;
  let best = solveSparse(target, opts);
  const support: number[] = [];

  const lowerBound = (start: number): number => {
    const relaxed = support.concat(Array.from({ length: dict.length - start }, (_, i) => start + i));
    if (relaxed.length === 0) return weightedRms(target64, w);
    const x = nnls(
      relaxed.map((j) => dict[j].payoff),
      target64,
      w,
      120,
    );
    const residual = Float64Array.from(target.g);
    relaxed.forEach((j, r) => {
      for (let t = 0; t < residual.length; t += 1) residual[t] -= x[r] * dict[j].payoff[t];
    });
    return weightedRms(residual, w);
  };

  const evaluate = () => {
    if (support.length === 0) return;
    const x = nnls(
      support.map((j) => dict[j].payoff),
      target64,
      w,
    );
    const candidate = solutionFromSupport(target, dict, support, x, w);
    if (betterSolution(candidate, best)) best = candidate;
  };

  const visit = (start: number) => {
    nodes += 1;
    if (nodes > maxNodes) return;
    evaluate();
    if (support.length >= opts.maxLegs || start >= dict.length) return;
    if (lowerBound(start) >= best.l2Error - 1e-12) return;

    support.push(start);
    visit(start + 1);
    support.pop();
    visit(start + 1);
  };

  visit(0);
  return best;
}

export function mutualCoherence(strikes: number[], maxMacroWidth?: number): number {
  const dict = pruneByCoherence(buildDictionary(strikes, maxMacroWidth), 0.999999);
  let mu = 0;
  for (let i = 0; i < dict.length; i += 1) {
    for (let j = i + 1; j < dict.length; j += 1) {
      mu = Math.max(mu, normalizedDot(dict[i].payoff, dict[j].payoff));
    }
  }
  return mu;
}

export function certifyGap(target: SparseTarget, maxLegs: number, opts: Pick<SolveOpts, 'maxMacroWidth'> = {}): GapCertificate {
  const coherence = mutualCoherence(target.gridStrikes, opts.maxMacroWidth);
  const threshold = 1 / Math.max(1, 2 * maxLegs - 1);
  const exactRecovery = coherence < threshold;
  const denom = 1 - Math.max(0, (maxLegs - 1) * coherence);
  const gapBound = exactRecovery ? 0 : denom > 0 ? coherence / denom : Number.POSITIVE_INFINITY;
  return { coherence, exactRecovery, gapBound, escalate: !exactRecovery };
}

export function solveCertifiedSparse(target: SparseTarget, opts: ExactSolveOpts): { solution: SparseSolution; certificate: GapCertificate } {
  const greedy = solveSparse(target, opts);
  const certificate = certifyGap(target, opts.maxLegs, opts);
  if (!certificate.escalate) return { solution: greedy, certificate };

  const maxSupports = opts.maxSupports ?? 100_000;
  try {
    const exact = solveExact(target, { ...opts, maxSupports });
    return { solution: betterSolution(exact, greedy) ? exact : greedy, certificate };
  } catch {
    return { solution: greedy, certificate };
  }
}
