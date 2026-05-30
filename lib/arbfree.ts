import type { SVI } from './types';

export interface ButterflyCheck {
  ok: boolean;
  minG: number;
  badIntervals: Array<[number, number]>;
  preScreenOk: boolean;
}

export interface RepairedDigital {
  strike: number;
  k: number;
  up: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function sviW(svi: SVI, k: number): number {
  const u = k - svi.m;
  return svi.a + svi.b * (svi.rho * u + Math.sqrt(u * u + svi.sigma * svi.sigma));
}

export function sviDerivs(svi: SVI, k: number): { w: number; wp: number; wpp: number } {
  const u = k - svi.m;
  const r = Math.sqrt(u * u + svi.sigma * svi.sigma);
  const w = svi.a + svi.b * (svi.rho * u + r);
  const wp = svi.b * (svi.rho + u / r);
  const wpp = (svi.b * svi.sigma * svi.sigma) / (r * r * r);
  return { w, wp, wpp };
}

export function gFunction(svi: SVI, k: number): number {
  const { w, wp, wpp } = sviDerivs(svi, k);
  if (w <= 0) return Number.NEGATIVE_INFINITY;
  const t1 = (1 - (k * wp) / (2 * w)) ** 2;
  const t2 = ((wp * wp) / 4) * (1 / w + 0.25);
  return t1 - t2 + wpp / 2;
}

export function detectButterflyViolation(
  svi: SVI,
  tYears = 1,
  opts: { kLo?: number; kHi?: number; dk?: number; tol?: number } = {},
): ButterflyCheck {
  const kLo = opts.kLo ?? -2;
  const kHi = opts.kHi ?? 2;
  const dk = opts.dk ?? 0.005;
  const tol = opts.tol ?? 1e-10;
  const preScreenOk = svi.b * (1 + Math.abs(svi.rho)) * tYears <= 4;
  let minG = Number.POSITIVE_INFINITY;
  const badIntervals: Array<[number, number]> = [];

  if (!preScreenOk) return { ok: false, minG: Number.NEGATIVE_INFINITY, badIntervals: [[kLo, kHi]], preScreenOk };

  let openBad: number | undefined;
  for (let k = kLo; k <= kHi + dk / 2; k += dk) {
    const g = gFunction(svi, k);
    minG = Math.min(minG, g);
    if (g < -tol && openBad === undefined) openBad = k;
    if (g >= -tol && openBad !== undefined) {
      badIntervals.push([openBad, k]);
      openBad = undefined;
    }
  }
  if (openBad !== undefined) badIntervals.push([openBad, kHi]);

  return { ok: badIntervals.length === 0, minG, badIntervals, preScreenOk };
}

function densityAt(svi: SVI, k: number): number {
  const w = Math.max(sviW(svi, k), 1e-12);
  const dMinus = (-k - 0.5 * w) / Math.sqrt(w);
  return Math.max(0, (gFunction(svi, k) / (SQRT_2PI * Math.sqrt(w))) * Math.exp((-dMinus * dMinus) / 2));
}

function integrationBounds(strikes: number[], forward: number): [number, number] {
  const ks = strikes.map((strike) => Math.log(strike / forward));
  const lo = Math.min(...ks);
  const hi = Math.max(...ks);
  const pad = Math.max(1, (hi - lo) * 2);
  return [Math.max(-8, lo - pad), Math.min(8, hi + pad)];
}

export function repairedDigitals(
  svi: SVI,
  forward: number,
  strikes: number[],
  opts: { dk?: number } = {},
): RepairedDigital[] {
  if (strikes.length === 0) return [];
  const dk = opts.dk ?? 0.0025;
  const [kLo, kHi] = integrationBounds(strikes, forward);
  const grid: number[] = [];
  const density: number[] = [];

  for (let k = kLo; k <= kHi + dk / 2; k += dk) {
    grid.push(k);
    density.push(densityAt(svi, k));
  }

  const rawMass = density.reduce((sum, value) => sum + value * dk, 0);
  const safeMass = rawMass > 0 ? rawMass : 1;
  const cdf: number[] = [];
  let acc = 0;
  for (const value of density) {
    acc += (value / safeMass) * dk;
    cdf.push(Math.min(1, Math.max(0, acc)));
  }

  const sorted = strikes
    .map((strike) => ({ strike, k: Math.log(strike / forward) }))
    .sort((a, b) => a.k - b.k);
  let lastUp = 1;
  const repaired = sorted.map(({ strike, k }) => {
    const idx = Math.min(grid.length - 1, Math.max(0, Math.round((k - kLo) / dk)));
    const up = Math.min(lastUp, Math.max(0, Math.min(1, 1 - cdf[idx])));
    lastUp = up;
    return { strike, k, up };
  });

  return repaired.sort((a, b) => a.strike - b.strike);
}

export function repairedDigitalUp(svi: SVI, forward: number, strike: number): number {
  return repairedDigitals(svi, forward, [strike])[0]?.up ?? 0;
}
