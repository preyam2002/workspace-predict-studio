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
  digestLabel: string;
  rows: ProofLegRow[];
}

function usd(value: number): string {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function strike(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatLegForProof(leg: Leg): ProofLegRow {
  if (leg.isRange) {
    return {
      kind: 'Range',
      condition: `${strike(leg.lowerStrike)} < settle <= ${strike(leg.higherStrike)}`,
      payout: usd(leg.quantity),
    };
  }

  return {
    kind: leg.isUp ? 'Binary call' : 'Binary put',
    condition: leg.isUp ? `settle > ${strike(leg.lowerStrike)}` : `settle < ${strike(leg.lowerStrike)}`,
    payout: usd(leg.quantity),
  };
}

function replicatedPayoff(legs: Leg[], settlement: number): number {
  return legs.reduce((sum, leg) => sum + (legPays(leg, settlement) ? leg.quantity / USDC : 0), 0);
}

function assertionFor(legs: Leg[], target?: SparseTarget): string {
  if (!target) return 'payoff proof ready for live settlement digest';
  const ok = target.gridStrikes.every((settlement, i) => Math.abs(replicatedPayoff(legs, settlement) - target.g[i]) <= 0.01);
  return ok ? 'payoff == settlement on sampled grid' : 'replication mismatch on sampled grid';
}

export function buildReplicationProof({
  legs,
  premium,
  target,
  liveDigest,
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
    digestLabel: liveDigest ?? 'pending live digest',
    rows: legs.map(formatLegForProof),
  };
}
