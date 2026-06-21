import { isConfiguredId } from './network-config';

type MintTransactionLike = {
  events?: Array<{ type?: string; parsedJson?: unknown }> | null;
  objectChanges?: Array<Record<string, unknown>> | null;
};

function parsedPositionId(value: unknown): string | undefined {
  const positionId = (value as { position_id?: unknown } | undefined)?.position_id;
  return typeof positionId === 'string' ? positionId : undefined;
}

export function mintedPositionIdFromTransaction(transaction: MintTransactionLike): string | undefined {
  const event = transaction.events?.find((item) => item.type?.endsWith('::studio::StructureMinted'));
  const eventPositionId = parsedPositionId(event?.parsedJson);
  if (eventPositionId) return eventPositionId;

  const createdPosition = transaction.objectChanges?.find(
    (change) => change.type === 'created' && String(change.objectType ?? '').endsWith('::studio::StructuredPosition'),
  );
  return typeof createdPosition?.objectId === 'string' ? createdPosition.objectId : undefined;
}

export function mintDisabledReason({
  explicitDisabled,
  pending,
  legsReady,
  managerId,
  dusdcType,
  accountConnected,
  accountAddress,
  managerOwner,
  oracleLive,
  netMaxGain,
}: {
  explicitDisabled?: boolean;
  pending: boolean;
  legsReady: boolean;
  managerId?: string;
  dusdcType?: string;
  accountConnected: boolean;
  accountAddress?: string;
  managerOwner?: string;
  oracleLive: boolean;
  netMaxGain?: number;
}): string | undefined {
  if (pending) return 'Minting';
  if (!accountConnected) return 'Connect wallet';
  if (explicitDisabled) return 'Missing package config';
  if (!oracleLive) return 'Oracle expired';
  if (!legsReady) return 'Waiting for quote';
  if (netMaxGain !== undefined && netMaxGain <= 0) return 'Quote exceeds payout';
  if (!isConfiguredId(managerId) || !dusdcType) return 'Missing manager/dUSDC';
  if (accountAddress && managerOwner && accountAddress.toLowerCase() !== managerOwner.toLowerCase()) return 'Manager wallet required';
  return undefined;
}
