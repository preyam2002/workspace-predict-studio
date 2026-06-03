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
  return [
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
  ].join('\n');
}
