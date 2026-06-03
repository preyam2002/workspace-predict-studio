import { describe, expect, it } from 'vitest';
import { formatLiveProof } from './live-proof';

describe('live proof summary', () => {
  it('formats pending settlement evidence from deploy metadata', () => {
    expect(
      formatLiveProof({
        packageId: '0xpackage',
        managerId: '0xmanager',
        vaultId: '0xvault',
        publishDigest: 'publish-digest',
        sampleMintDigest: 'mint-digest',
        samplePositionId: '0xposition',
        keeperRollDigest: 'roll-digest',
        keeperRollPositionId: '0xvault-position',
      }),
    ).toContain('sample settle:    pending');
  });

  it('formats recorded settlement digests and payouts', () => {
    const proof = formatLiveProof({
      packageId: '0xpackage',
      managerId: '0xmanager',
      vaultId: '0xvault',
      publishDigest: 'publish-digest',
      sampleMintDigest: 'mint-digest',
      samplePositionId: '0xposition',
      keeperRollDigest: 'roll-digest',
      keeperRollPositionId: '0xvault-position',
      sampleSettleDigest: 'sample-settle-digest',
      sampleSettlePayout: '1000000',
      sampleSettlePnlIsGain: true,
      sampleSettlePnlAbs: '475799',
      vaultSettleDigest: 'vault-settle-digest',
      vaultSettlePayout: '0',
      vaultSettlePnlIsGain: false,
      vaultSettlePnlAbs: '527804',
    });

    expect(proof).toContain('sample settle:    sample-settle-digest payout=1000000 pnl=+475799');
    expect(proof).toContain('vault settle:     vault-settle-digest payout=0 pnl=-527804');
  });
});
