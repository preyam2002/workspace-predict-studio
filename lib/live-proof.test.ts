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

  it('formats recorded K2 note-backed lending proof', () => {
    const proof = formatLiveProof({
      k2_note_lending: {
        collateralPackageId: '0xk2package',
        noteCollateralMarketId: '0xmarket',
        mintBorrowDigest: 'mint-borrow-digest',
        repayReclaimDigest: 'repay-reclaim-digest',
      },
    });

    expect(proof).toContain('k2 package:       0xk2package');
    expect(proof).toContain('k2 note market:   0xmarket');
    expect(proof).toContain('k2 mint+borrow:   mint-borrow-digest');
    expect(proof).toContain('k2 repay+reclaim: repay-reclaim-digest');
  });
});
