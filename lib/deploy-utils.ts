interface ObjectChange {
  type?: string;
  packageId?: string;
  objectId?: string;
  objectType?: string;
}

export interface PublishParseResult {
  packageId: string;
  shareFactoryId?: string;
}

export interface VaultSetupParseResult {
  vaultId?: string;
  managerEscrowId?: string;
}

export function parsePublishResult(result: { objectChanges?: ObjectChange[] | null }): PublishParseResult {
  const packageId = result.objectChanges?.find((change) => change.type === 'published')?.packageId;
  if (!packageId) throw new Error('Publish succeeded but package id was not found in objectChanges');

  const shareFactoryId = result.objectChanges?.find((change) => change.objectType?.endsWith('::studio_lp::ShareFactory'))?.objectId;
  return { packageId, shareFactoryId };
}

export function parseVaultSetupResult(result: { objectChanges?: ObjectChange[] | null }): VaultSetupParseResult {
  const vaultId = result.objectChanges?.find((change) => change.objectType?.includes('::vault::StructuredVault'))?.objectId;
  const managerEscrowId = result.objectChanges?.find((change) => change.objectType?.endsWith('::vault::ManagerEscrow'))?.objectId;
  return { vaultId, managerEscrowId };
}
