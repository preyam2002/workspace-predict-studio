import { describe, expect, it } from 'vitest';
import { buildReplicationProof, formatLegForProof } from './replication-proof';
import type { Leg, SparseTarget } from './types';

describe('replication proof helpers', () => {
  const legs: Leg[] = [
    { isRange: true, isUp: false, lowerStrike: 90, higherStrike: 110, quantity: 1_000_000 },
    { isRange: false, isUp: true, lowerStrike: 115, higherStrike: 0, quantity: 500_000 },
  ];

  it('formats Predict range and binary legs for the judge-facing proof surface', () => {
    expect(formatLegForProof(legs[0])).toMatchObject({
      kind: 'Range',
      condition: '90 < settle <= 110',
      payout: '$1.00',
    });
    expect(formatLegForProof(legs[1])).toMatchObject({
      kind: 'Binary call',
      condition: 'settle > 115',
      payout: '$0.50',
    });
  });

  it('proves sampled target payoff matches replicated Predict leg settlement', () => {
    const target: SparseTarget = {
      gridStrikes: [80, 95, 110, 116],
      g: [0, 1, 1, 0.5],
    };

    const proof = buildReplicationProof({ legs, premium: 320_000, target });

    expect(proof.legCount).toBe(2);
    expect(proof.onePtb).toBe(true);
    expect(proof.maxLossEqualsPremium).toBe(true);
    expect(proof.assertion).toBe('payoff == settlement on sampled grid');
    expect(proof.digestLabel).toBe('pending live digest');
    expect(proof.rows).toHaveLength(2);
  });

  it('flags a mismatch instead of overstating proof', () => {
    const proof = buildReplicationProof({
      legs,
      premium: 320_000,
      target: { gridStrikes: [95], g: [0] },
    });

    expect(proof.assertion).toBe('replication mismatch on sampled grid');
  });
});
