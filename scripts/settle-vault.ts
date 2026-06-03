import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSettleVaultPtbArgs, oracleSettlementStatus, parseSuiJsonOutput, vaultStrategyStatus } from '../lib/settle-sample';

type JsonObject = Record<string, unknown>;

interface LiveConfig {
  predictId?: string;
  managerId?: string;
  oracleId?: string;
  quoteType?: string;
  dusdcType?: string;
  vaultId?: string;
  managerEscrowId?: string;
  keeperCapId?: string;
}

interface DeployInfo {
  packageId?: string;
  vaultId?: string;
  managerEscrowId?: string;
  keeperCapId?: string;
  keeperRollPositionId?: string;
  vaultSettleDigest?: string;
  vaultSettlePayout?: string;
  vaultSettlePnlIsGain?: boolean;
  vaultSettlePnlAbs?: string;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readObject(id: string): JsonObject {
  return JSON.parse(execFileSync('sui', ['client', 'object', id, '--json'], { encoding: 'utf8' })) as JsonObject;
}

function requireValue(value: string | undefined, label: string): string {
  if (!value || value.startsWith('replace-')) throw new Error(`${label} is missing`);
  return value;
}

function structureSettledEvent(result: JsonObject) {
  const events = result.events as Array<{ type?: string; parsedJson?: Record<string, unknown> }> | undefined;
  return events?.find((event) => event.type?.endsWith('::studio::StructureSettled'))?.parsedJson;
}

const execute = process.argv.includes('--execute');
const force = process.argv.includes('--force');
const cfg = readJson<LiveConfig>('./scripts/config.json');
const deploy = readJson<DeployInfo>('./deploy.json');

const input = {
  packageId: requireValue(deploy.packageId, 'packageId'),
  vaultId: requireValue(deploy.vaultId ?? cfg.vaultId, 'vaultId'),
  keeperCapId: requireValue(deploy.keeperCapId ?? cfg.keeperCapId, 'keeperCapId'),
  managerEscrowId: requireValue(deploy.managerEscrowId ?? cfg.managerEscrowId, 'managerEscrowId'),
  predictId: requireValue(cfg.predictId, 'predictId'),
  managerId: requireValue(cfg.managerId, 'managerId'),
  oracleId: requireValue(cfg.oracleId, 'oracleId'),
  quoteType: requireValue(cfg.quoteType ?? cfg.dusdcType, 'quoteType'),
};

const vault = readObject(input.vaultId);
const strategy = vaultStrategyStatus(vault);
if (!strategy.open) {
  console.log(`${deploy.vaultSettleDigest ? 'vault_already_settled' : 'vault_no_open_strategy'}\t${input.vaultId}`);
  process.exit(0);
}

const oracleId = requireValue(strategy.oracleId ?? input.oracleId, 'vault oracleId');
const oracle = readObject(oracleId);
const settlement = oracleSettlementStatus(oracle);
if (!settlement.settled && !force) {
  console.log(`oracle_not_settled\t${oracleId}\tposition=${strategy.positionId ?? 'unknown'}\texpiry=${settlement.expiryMs ?? 'unknown'}`);
} else {
  const args = buildSettleVaultPtbArgs({ ...input, oracleId }, { execute });
  const result = parseSuiJsonOutput<JsonObject>(execFileSync('sui', args, { encoding: 'utf8' }));
  const digest =
    (result.digest as string | undefined) ??
    ((result.effects as { transactionDigest?: string } | undefined)?.transactionDigest as string | undefined);
  console.log(`${execute ? 'vault_settle_execute' : 'vault_settle_dry_run'}\t${digest ?? 'no-digest'}`);

  const event = structureSettledEvent(result);
  if (event) {
    console.log(
      `structure_settled\tpayout=${String(event.payout)}\tpnl_is_gain=${String(event.pnl_is_gain)}\tpnl_abs=${String(event.pnl_abs)}`,
    );
  }

  if (execute && digest) {
    writeFileSync(
      './deploy.json',
      `${JSON.stringify(
        {
          ...deploy,
          vaultSettleDigest: digest,
          vaultSettlePayout: event?.payout,
          vaultSettlePnlIsGain: event?.pnl_is_gain,
          vaultSettlePnlAbs: event?.pnl_abs,
        },
        null,
        2,
      )}\n`,
    );
  }
}
