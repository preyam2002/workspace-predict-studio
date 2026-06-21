export interface LiveProofDeployInfo {
  packageId?: string;
  managerId?: string;
  vaultId?: string;
  publishDigest?: string;
  sampleMintDigest?: string;
  samplePositionId?: string;
  sampleSettleDigest?: string;
  sampleSettlePayout?: string;
  sampleSettlePnlIsGain?: boolean;
  sampleSettlePnlAbs?: string;
  keeperRollDigest?: string;
  keeperRollPositionId?: string;
  vaultSettleDigest?: string;
  vaultSettlePayout?: string;
  vaultSettlePnlIsGain?: boolean;
  vaultSettlePnlAbs?: string;
  k2_note_lending?: {
    collateralPackageId?: string;
    noteCollateralMarketId?: string;
    marketCreateDigest?: string;
    seedWithdrawDigest?: string;
    mintBorrowDigest?: string;
    noteBorrowId?: string;
    repayReclaimDigest?: string;
    reclaimedNoteId?: string;
  };
}

function value(input: string | undefined): string {
  return input ?? 'pending';
}

function pnl(isGain: boolean | undefined, amount: string | undefined): string {
  if (amount === undefined) return '';
  return ` pnl=${isGain ? '+' : '-'}${amount}`;
}

function settleLine(digest: string | undefined, payout: string | undefined, isGain: boolean | undefined, amount: string | undefined): string {
  if (!digest) return 'pending';
  return `${digest} payout=${value(payout)}${pnl(isGain, amount)}`;
}

export function formatLiveProof(deploy: LiveProofDeployInfo): string {
  const lines = [
    'Live proof summary',
    `package:          ${value(deploy.packageId)}`,
    `manager:          ${value(deploy.managerId)}`,
    `vault:            ${value(deploy.vaultId)}`,
    `publish:          ${value(deploy.publishDigest)}`,
    `sample mint:      ${value(deploy.sampleMintDigest)}`,
    `sample position:  ${value(deploy.samplePositionId)}`,
    `sample settle:    ${settleLine(
      deploy.sampleSettleDigest,
      deploy.sampleSettlePayout,
      deploy.sampleSettlePnlIsGain,
      deploy.sampleSettlePnlAbs,
    )}`,
    `vault roll:       ${value(deploy.keeperRollDigest)}`,
    `vault position:   ${value(deploy.keeperRollPositionId)}`,
    `vault settle:     ${settleLine(
      deploy.vaultSettleDigest,
      deploy.vaultSettlePayout,
      deploy.vaultSettlePnlIsGain,
      deploy.vaultSettlePnlAbs,
    )}`,
  ];
  if (deploy.k2_note_lending) {
    lines.push(
      `k2 package:       ${value(deploy.k2_note_lending.collateralPackageId)}`,
      `k2 note market:   ${value(deploy.k2_note_lending.noteCollateralMarketId)}`,
      `k2 create market: ${value(deploy.k2_note_lending.marketCreateDigest)}`,
      `k2 seed market:   ${value(deploy.k2_note_lending.seedWithdrawDigest)}`,
      `k2 mint+borrow:   ${value(deploy.k2_note_lending.mintBorrowDigest)}`,
      `k2 note borrow:   ${value(deploy.k2_note_lending.noteBorrowId)}`,
      `k2 repay+reclaim: ${value(deploy.k2_note_lending.repayReclaimDigest)}`,
      `k2 reclaimed note: ${value(deploy.k2_note_lending.reclaimedNoteId)}`,
    );
  }
  return lines.join('\n');
}
