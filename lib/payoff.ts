import { detectButterflyViolation, repairedDigitals } from './arbfree';
import type { Leg, SVI } from './types';

const guardCache = new Map<string, ReturnType<typeof detectButterflyViolation>>();
const repairCache = new Map<string, ReturnType<typeof repairedDigitals>>();

function surfaceKey(svi: SVI): string {
  return [svi.a, svi.b, svi.rho, svi.m, svi.sigma].join(':');
}

function repairKey(svi: SVI, forward: number, strikes: number[]): string {
  return `${surfaceKey(svi)}:${forward}:${strikes.join(',')}`;
}

function butterflyCheck(svi: SVI) {
  const key = surfaceKey(svi);
  const cached = guardCache.get(key);
  if (cached) return cached;
  const check = detectButterflyViolation(svi, 1, { kLo: -2, kHi: 2, dk: 0.01 });
  guardCache.set(key, check);
  return check;
}

function repairedUpValues(svi: SVI, forward: number, strikes: number[]) {
  const sorted = [...strikes].sort((a, b) => a - b);
  const key = repairKey(svi, forward, sorted);
  const cached = repairCache.get(key);
  if (cached) return cached;
  const repaired = repairedDigitals(svi, forward, sorted, { dk: 0.005 });
  repairCache.set(key, repaired);
  return repaired;
}

export function clearPricingCaches() {
  guardCache.clear();
  repairCache.clear();
}

export function pricingCacheSizes() {
  return { guard: guardCache.size, repair: repairCache.size };
}

export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function totalVariance(svi: SVI, k: number): number {
  const km = k - svi.m;
  return svi.a + svi.b * (svi.rho * km + Math.sqrt(km * km + svi.sigma * svi.sigma));
}

function closedFormPriceUp(svi: SVI, forward: number, strike: number): number {
  const k = Math.log(strike / forward);
  const w = Math.max(totalVariance(svi, k), 1e-12);
  const d2 = (Math.log(forward / strike) - 0.5 * w) / Math.sqrt(w);
  return Math.min(0.999, Math.max(0.001, normCdf(d2)));
}

export function priceUp(svi: SVI, forward: number, strike: number): number {
  const check = butterflyCheck(svi);
  if (!check.ok) return repairedUpValues(svi, forward, [strike])[0]?.up ?? 0;
  return closedFormPriceUp(svi, forward, strike);
}

export function priceDown(svi: SVI, forward: number, strike: number): number {
  return 1 - priceUp(svi, forward, strike);
}

export function priceRange(svi: SVI, forward: number, lo: number, hi: number): number {
  const strikes = [Math.min(lo, hi), Math.max(lo, hi)];
  const check = butterflyCheck(svi);
  if (!check.ok) {
    const repaired = repairedUpValues(svi, forward, strikes);
    return Math.max(0, repaired[0].up - repaired[1].up);
  }
  return Math.max(0, closedFormPriceUp(svi, forward, strikes[0]) - closedFormPriceUp(svi, forward, strikes[1]));
}

export function impliedProb(askPriceScaled: number): number {
  return askPriceScaled / 1_000_000_000;
}

export function legProb(svi: SVI, forward: number, leg: Leg): number {
  if (leg.isRange) return priceRange(svi, forward, leg.lowerStrike, leg.higherStrike);
  return leg.isUp ? priceUp(svi, forward, leg.lowerStrike) : priceDown(svi, forward, leg.lowerStrike);
}

export function legPays(leg: Leg, settlement: number): boolean {
  if (leg.isRange) return settlement > leg.lowerStrike && settlement <= leg.higherStrike;
  return leg.isUp ? settlement > leg.lowerStrike : settlement < leg.lowerStrike;
}

export function pnlAt(legs: Leg[], premium: number, settlement: number): number {
  return legs.reduce((sum, leg) => sum + (legPays(leg, settlement) ? leg.quantity : 0), 0) - premium;
}

function breakpoints(legs: Leg[]): number[] {
  const set = new Set<number>();
  for (const leg of legs) {
    set.add(leg.lowerStrike);
    if (leg.isRange) set.add(leg.higherStrike);
  }
  return [...set].sort((a, b) => a - b);
}

function representativeSettlements(legs: Leg[]): number[] {
  const bps = breakpoints(legs);
  if (bps.length === 0) return [0];
  const samples = new Set<number>([0]);
  for (const bp of bps) {
    if (bp > 0) samples.add(bp - 1);
    samples.add(bp);
    samples.add(bp + 1);
  }
  return [...samples].sort((a, b) => a - b);
}

export function maxLoss(premium: number): number {
  return premium;
}

export function maxGain(legs: Leg[], premium: number): number {
  return Math.max(...representativeSettlements(legs).map((s) => pnlAt(legs, premium, s)));
}

export function breakevens(legs: Leg[], premium: number): number[] {
  const samples = representativeSettlements(legs);
  const out: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const previous = pnlAt(legs, premium, samples[i - 1]);
    const next = pnlAt(legs, premium, samples[i]);
    if ((previous < 0 && next >= 0) || (previous >= 0 && next < 0)) {
      out.push(samples[i]);
    }
  }
  return [...new Set(out)];
}

export function ev(legs: Leg[], svi: SVI, forward: number, premium: number): number {
  return legs.reduce((sum, leg) => sum + legProb(svi, forward, leg) * leg.quantity, 0) - premium;
}

export function payoffCurve(legs: Leg[], premium: number, lo: number, hi: number, n = 200) {
  const pts: { s: number; pnl: number }[] = [];
  for (let i = 0; i <= n; i += 1) {
    const s = lo + (hi - lo) * (i / n);
    pts.push({ s, pnl: pnlAt(legs, premium, s) });
  }
  return pts;
}

export function greeksUp(svi: SVI, forward: number, strike: number, tauYears: number) {
  const price = priceUp(svi, forward, strike);
  const dF = Math.max(1, forward * 1e-4);
  const delta = (priceUp(svi, forward + dF, strike) - priceUp(svi, forward - dF, strike)) / (2 * dF);
  const bump: SVI = { ...svi, sigma: svi.sigma + 1e-4 };
  const vega = priceUp(bump, forward, strike) - price;
  const theta = tauYears > 1e-6 ? -price / (tauYears * 365) : 0;
  return { price, delta, vega, theta };
}
