import type { Leg } from './types';
import { pnlAt } from './payoff';

export interface Settlement {
  settlementPrice: number;
  expiryMs: number;
}

export interface BacktestResult {
  runs: number;
  hitRate: number;
  avgPnl: number;
  pnls: number[];
}

export function backtest(legs: Leg[], premium: number, history: Settlement[]): BacktestResult {
  const pnls = history.map((item) => pnlAt(legs, premium, item.settlementPrice));
  const wins = pnls.filter((pnl) => pnl > 0).length;
  return {
    runs: pnls.length,
    hitRate: pnls.length ? wins / pnls.length : 0,
    avgPnl: pnls.length ? pnls.reduce((sum, pnl) => sum + pnl, 0) / pnls.length : 0,
    pnls,
  };
}

export function syntheticSettlements(forward: number, sigmaAnnual: number, tauYears: number, n = 2000): Settlement[] {
  const out: Settlement[] = [];
  for (let i = 0; i < n; i += 1) {
    const z = gaussian();
    const settlementPrice =
      forward * Math.exp(-0.5 * sigmaAnnual ** 2 * tauYears + sigmaAnnual * Math.sqrt(tauYears) * z);
    out.push({ settlementPrice, expiryMs: 0 });
  }
  return out;
}

function gaussian() {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
