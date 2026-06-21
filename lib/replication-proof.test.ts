import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
      condition: 'Settlement above $90 and at or below $110',
      payout: '$1.00',
    });
    expect(formatLegForProof(legs[1])).toMatchObject({
      kind: 'Binary call',
      condition: 'Settlement above $115',
      payout: '$0.50',
    });
  });

  it('formats scaled chain strikes as human dollar values', () => {
    expect(
      formatLegForProof({
        isRange: true,
        isUp: false,
        lowerStrike: 64_049_000_000_000,
        higherStrike: 64_053_000_000_000,
        quantity: 5_000_000,
      }),
    ).toMatchObject({
      condition: 'Settlement above $64,049 and at or below $64,053',
      payout: '$5.00',
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
    expect(proof.assertion).toBe('Payoff matches the sampled settlement grid.');
    expect(proof.rows).toHaveLength(2);
  });

  it('flags a mismatch instead of overstating proof', () => {
    const proof = buildReplicationProof({
      legs,
      premium: 320_000,
      target: { gridStrikes: [95], g: [0] },
    });

    expect(proof.assertion).toBe('Payoff does not match the sampled settlement grid.');
  });

  it('labels the panel as payoff rules instead of live proof', () => {
    const proofPanel = readFileSync('app/components/ReplicationProofPanel.tsx', 'utf8');

    expect(proofPanel).toContain('Payoff rules');
    expect(proofPanel).toContain('Settlement conditions');
    expect(proofPanel).not.toContain('<div className="metric-label">Proof</div>');
    expect(proofPanel).not.toContain('Digest:');
  });

  it('keeps long proof and config text inside narrow UI cards', () => {
    const proofPanel = readFileSync('app/components/ReplicationProofPanel.tsx', 'utf8');
    const collateralPanel = readFileSync('app/components/NoteCollateralPanel.tsx', 'utf8');

    expect(proofPanel).toContain('md:grid-cols-[92px_minmax(0,1fr)_auto]');
    expect(proofPanel).toContain('className="min-w-0 break-words"');
    expect(collateralPanel).toContain('className="mt-2 surface px-3 py-2 text-xs warn-text leading-relaxed break-words"');
    expect(collateralPanel).toContain('className="break-all"');
  });
});
