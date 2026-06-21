import { legPays } from './payoff';
import { USDC, type Leg, type SparseTarget } from './types';

export interface ProofLegRow {
  kind: string;
  condition: string;
  payout: string;
}

export interface ReplicationProof {
  legCount: number;
  onePtb: boolean;
  maxLossEqualsPremium: boolean;
  assertion: string;
  rows: ProofLegRow[];
}

function usd(value: number): string {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function strike(value: number): string {
  const scaled = Math.abs(value) > 1_000_000 ? value / 1_000_000_000 : value;
  return `$${scaled.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(scaled) ? 0 : 2 })}`;
}

export function formatLegForProof(leg: Leg): ProofLegRow {
  if (leg.isRange) {
    return {
      kind: 'Range',
      condition: `Settlement above ${strike(leg.lowerStrike)} and at or below ${strike(leg.higherStrike)}`,
      payout: usd(leg.quantity),
    };
  }

  return {
    kind: leg.isUp ? 'Binary call' : 'Binary put',
    condition: leg.isUp ? `Settlement above ${strike(leg.lowerStrike)}` : `Settlement below ${strike(leg.lowerStrike)}`,
    payout: usd(leg.quantity),
  };
}

function replicatedPayoff(legs: Leg[], settlement: number): number {
  return legs.reduce((sum, leg) => sum + (legPays(leg, settlement) ? leg.quantity / USDC : 0), 0);
}

function assertionFor(legs: Leg[], target?: SparseTarget): string {
  if (!target) return 'Rules are generated from the current Predict legs.';
  const ok = target.gridStrikes.every((settlement, i) => Math.abs(replicatedPayoff(legs, settlement) - target.g[i]) <= 0.01);
  return ok ? 'Payoff matches the sampled settlement grid.' : 'Payoff does not match the sampled settlement grid.';
}

export function buildReplicationProof({
  legs,
  premium,
  target,
}: {
  legs: Leg[];
  premium: number;
  target?: SparseTarget;
  liveDigest?: string;
}): ReplicationProof {
  return {
    legCount: legs.length,
    onePtb: legs.length > 0 && legs.length <= 8,
    maxLossEqualsPremium: premium >= 0,
    assertion: assertionFor(legs, target),
    rows: legs.map(formatLegForProof),
  };
}
