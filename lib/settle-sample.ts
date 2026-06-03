export interface SettleSampleInput {
  packageId: string;
  predictId: string;
  managerId: string;
  oracleId: string;
  positionId: string;
  dusdcType: string;
}

export interface SettleVaultInput {
  packageId: string;
  vaultId: string;
  keeperCapId: string;
  managerEscrowId: string;
  predictId: string;
  managerId: string;
  oracleId: string;
  quoteType: string;
}

export interface SettleSampleOptions {
  execute?: boolean;
  gasBudget?: string;
}

export interface OracleSettlementStatus {
  settled: boolean;
  expiryMs?: number;
  settlementPrice?: string;
}

export interface VaultStrategyStatus {
  open: boolean;
  positionId?: string;
  oracleId?: string;
  positionSettled?: boolean;
}

type ObjectJson = { content?: Record<string, unknown> };

function objectContent(value: ObjectJson): Record<string, unknown> {
  return value.content ?? {};
}

export function buildSettleSamplePtbArgs(input: SettleSampleInput, options: SettleSampleOptions = {}): string[] {
  const args = [
    'client',
    'ptb',
    '--move-call',
    `${input.packageId}::studio::settle_to_receipt`,
    `<${input.dusdcType}>`,
    `@${input.predictId}`,
    `@${input.managerId}`,
    `@${input.oracleId}`,
    `@${input.positionId}`,
    '@0x6',
    '--gas-budget',
    options.gasBudget ?? '50000000',
    '--json',
  ];
  if (!options.execute) args.push('--dry-run');
  return args;
}

export function buildSettleVaultPtbArgs(input: SettleVaultInput, options: SettleSampleOptions = {}): string[] {
  const args = [
    'client',
    'ptb',
    '--move-call',
    `${input.packageId}::vault::keeper_settle`,
    `<${input.quoteType}>`,
    `@${input.vaultId}`,
    `@${input.keeperCapId}`,
    `@${input.managerEscrowId}`,
    `@${input.predictId}`,
    `@${input.managerId}`,
    `@${input.oracleId}`,
    '@0x6',
    '--gas-budget',
    options.gasBudget ?? '50000000',
    '--json',
  ];
  if (!options.execute) args.push('--dry-run');
  return args;
}

export function parseSuiJsonOutput<T = Record<string, unknown>>(stdout: string): T {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    if (start < 0) {
      const dryRunStatus = trimmed.match(/^Dry run completed, execution status: ([a-zA-Z_]+)/);
      if (dryRunStatus) return { effects: { status: { status: dryRunStatus[1] } } } as T;
      throw new Error('Sui CLI output did not contain a JSON object');
    }
    return JSON.parse(trimmed.slice(start)) as T;
  }
}

export function oracleSettlementStatus(object: ObjectJson): OracleSettlementStatus {
  const content = objectContent(object);
  const settlement = content.settlement_price;
  const expiry = content.expiry;
  return {
    settled: settlement !== null && settlement !== undefined,
    expiryMs: expiry === undefined ? undefined : Number(expiry),
    settlementPrice: settlement === null || settlement === undefined ? undefined : String(settlement),
  };
}

export function positionSettled(object: ObjectJson): boolean {
  return Boolean(objectContent(object).settled);
}

export function vaultStrategyStatus(object: ObjectJson): VaultStrategyStatus {
  const content = objectContent(object);
  const open = content.open as Record<string, unknown> | undefined;
  if (!content.strategy_open || !open) return { open: false };
  return {
    open: true,
    positionId: open.id === undefined ? undefined : String(open.id),
    oracleId: open.oracle_id === undefined ? undefined : String(open.oracle_id),
    positionSettled: open.settled === undefined ? undefined : Boolean(open.settled),
  };
}
