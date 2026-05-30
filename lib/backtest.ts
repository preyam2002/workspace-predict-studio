import type { Leg } from './types';
import { pnlAt, totalVariance } from './payoff';
import type { OracleState } from './types';

export interface Settlement {
  settlementPrice: number;
  expiryMs: number;
}

export interface BacktestResult {
  runs: number;
  hitRate: number;
  avgPnl: number;
  pnls: number[];
  source?: 'history' | 'synthetic';
}

export function backtest(legs: Leg[], premium: number, history: Settlement[], source: BacktestResult['source'] = 'history'): BacktestResult {
  const pnls = history.map((item) => pnlAt(legs, premium, item.settlementPrice));
  const wins = pnls.filter((pnl) => pnl > 0).length;
  return {
    runs: pnls.length,
    hitRate: pnls.length ? wins / pnls.length : 0,
    avgPnl: pnls.length ? pnls.reduce((sum, pnl) => sum + pnl, 0) / pnls.length : 0,
    pnls,
    source,
  };
}

export function syntheticSettlements(forward: number, sigmaAnnual: number, tauYears: number, n = 2000, seed = 7): Settlement[] {
  const out: Settlement[] = [];
  const random = seededRandom(seed);
  for (let i = 0; i < n; i += 1) {
    const z = gaussian(random);
    const settlementPrice =
      forward * Math.exp(-0.5 * sigmaAnnual ** 2 * tauYears + sigmaAnnual * Math.sqrt(tauYears) * z);
    out.push({ settlementPrice, expiryMs: 0 });
  }
  return out;
}

export function backtestWithFallback(
  legs: Leg[],
  premium: number,
  history: Settlement[],
  oracle: Pick<OracleState, 'expiryMs' | 'nowMs' | 'forward' | 'svi'>,
  minHistory = 10,
): BacktestResult {
  if (history.length >= minHistory) return backtest(legs, premium, history, 'history');
  const tauYears = Math.max(1 / (365 * 24), (oracle.expiryMs - oracle.nowMs) / (365 * 24 * 60 * 60 * 1000));
  const atmTotalVariance = Math.max(totalVariance(oracle.svi, 0), 1e-12);
  const sigmaAnnual = Math.sqrt(atmTotalVariance / tauYears);
  return backtest(legs, premium, syntheticSettlements(oracle.forward, sigmaAnnual, tauYears, 500, 11), 'synthetic');
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) + 1) / 4_294_967_297;
  };
}

function gaussian(random: () => number) {
  let u = 0;
  let v = 0;
  while (!u) u = random();
  while (!v) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
