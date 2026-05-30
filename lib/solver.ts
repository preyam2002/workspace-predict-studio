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
  const w = Float64Array.from(opts.weights ?? new Array(n).fill(1)).map((v) => Math.sqrt(v));
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

  const legs = selected
    .map((j, r) => ({ ...dict[j].leg, quantity: Math.round(coef[r] * USDC) }))
    .filter((leg) => leg.quantity > 0);
  const roundedResidual = Float64Array.from(g);
  for (const leg of legs) {
    const qty = leg.quantity / USDC;
    const payoff = payoffVector(leg, strikes);
    for (let t = 0; t < n; t += 1) roundedResidual[t] -= qty * payoff[t];
  }

  let maxAbsError = 0;
  for (const v of roundedResidual) maxAbsError = Math.max(maxAbsError, Math.abs(v));

  return {
    legs,
    l2Error: weightedRms(roundedResidual, w),
    maxAbsError,
    premiumEst: 0,
    legCount: legs.length,
  };
}

export function priceSolution(sol: SparseSolution, svi: SVI, forward: number): SparseSolution {
  const premiumEst = sol.legs.reduce((sum, leg) => sum + legProb(svi, forward, leg) * (leg.quantity / USDC), 0);
  return { ...sol, premiumEst };
}
