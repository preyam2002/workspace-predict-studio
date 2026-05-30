import { priceUp } from '../lib/payoff';
import type { OracleState } from '../lib/types';

export interface DeltaBand {
  downsideDelta: number;
  upsideDelta: number;
}

export interface KeeperRollPlan {
  action: 'wait' | 'roll';
  lowerStrike: number;
  higherStrike: number;
  budget: number;
}

function grid(oracle: Pick<OracleState, 'minStrike' | 'maxStrike' | 'tickSize'>): number[] {
  const out: number[] = [];
  for (let k = oracle.minStrike; k <= oracle.maxStrike; k += oracle.tickSize) out.push(k);
  return out;
}

export function chooseStrikeForUpProbability(oracle: OracleState, targetUpProbability: number): number {
  let best = oracle.minStrike;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const strike of grid(oracle)) {
    const err = Math.abs(priceUp(oracle.svi, oracle.forward, strike) - targetUpProbability);
    if (err < bestErr) {
      bestErr = err;
      best = strike;
    }
  }
  return best;
}

export function selectRangeBand(oracle: OracleState, band: DeltaBand): { lowerStrike: number; higherStrike: number } {
  const lowerStrike = chooseStrikeForUpProbability(oracle, 1 - band.downsideDelta);
  const higherStrike = chooseStrikeForUpProbability(oracle, band.upsideDelta);
  return {
    lowerStrike: Math.min(lowerStrike, higherStrike - oracle.tickSize),
    higherStrike: Math.max(higherStrike, lowerStrike + oracle.tickSize),
  };
}

export function planKeeperRoll(
  oracle: OracleState,
  band: DeltaBand,
  budget: number,
  nowMs = Date.now(),
): KeeperRollPlan {
  const strikes = selectRangeBand(oracle, band);
  if (oracle.status === 'active' && nowMs < oracle.expiryMs) {
    return { action: 'wait', ...strikes, budget };
  }
  return { action: 'roll', ...strikes, budget };
}
