import { basketGreeks, breakevens, maxGain, maxLoss, payoffCurve } from './payoff';
import type { BasketGreeks } from './payoff';
import type { Leg, OracleState } from './types';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface NoteAnalytics {
  greeks: BasketGreeks;
  tauYears: number;
  payoff: {
    maxLoss: number;
    maxGain: number;
    breakevens: number[];
    minPnl: number;
    maxPnl: number;
  };
}

export function yearsToExpiry(oracle: Pick<OracleState, 'expiryMs' | 'nowMs'>): number {
  return Math.max((oracle.expiryMs - oracle.nowMs) / YEAR_MS, 1 / 365 / 24);
}

export function noteAnalytics({ legs, premium, oracle }: { legs: Leg[]; premium: number; oracle: OracleState }): NoteAnalytics {
  const tauYears = yearsToExpiry(oracle);
  const curve = payoffCurve(legs, premium, oracle.minStrike, oracle.maxStrike, 120);
  const pnls = curve.map((point) => point.pnl);
  return {
    greeks: basketGreeks(legs, oracle.svi, oracle.forward, tauYears),
    tauYears,
    payoff: {
      maxLoss: maxLoss(premium),
      maxGain: maxGain(legs, premium),
      breakevens: breakevens(legs, premium),
      minPnl: Math.min(...pnls),
      maxPnl: Math.max(...pnls),
    },
  };
}
