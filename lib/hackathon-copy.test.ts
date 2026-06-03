import { describe, expect, it } from 'vitest';
import { HACKATHON_SPINE, OPTIONS_GAP_WEDGE, TECHNICAL_KERNELS } from './hackathon-copy';

describe('hackathon narrative copy', () => {
  it('keeps the real-world spine and technical kernels explicit', () => {
    expect(HACKATHON_SPINE).toContain('English');
    expect(HACKATHON_SPINE).toContain('gasless');
    expect(OPTIONS_GAP_WEDGE).toContain('$100M');
    expect(TECHNICAL_KERNELS).toEqual([
      'Arb-free SVI repair',
      'Gas-bounded NNOMP replication',
      'Impact-aware execution ordering',
      'Replication equals settlement property tests',
    ]);
  });
});
