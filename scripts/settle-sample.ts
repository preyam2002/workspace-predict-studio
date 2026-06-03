import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSettleSamplePtbArgs, oracleSettlementStatus, parseSuiJsonOutput, positionSettled } from '../lib/settle-sample';

type JsonObject = Record<string, unknown>;

interface LiveConfig {
  predictId?: string;
  managerId?: string;
  oracleId?: string;
  dusdcType?: string;
  samplePositionId?: string;
}

interface DeployInfo {
  packageId?: string;
  samplePositionId?: string;
  samplePositionOracleId?: string;
  sampleSettleDigest?: string;
  sampleSettlePayout?: string;
  sampleSettlePnlIsGain?: boolean;
  sampleSettlePnlAbs?: string;
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
  predictId: requireValue(cfg.predictId, 'predictId'),
  managerId: requireValue(cfg.managerId, 'managerId'),
  oracleId: requireValue(deploy.samplePositionOracleId ?? cfg.oracleId, 'sample oracleId'),
  positionId: requireValue(deploy.samplePositionId ?? cfg.samplePositionId, 'sample positionId'),
  dusdcType: requireValue(cfg.dusdcType, 'dusdcType'),
};

const position = readObject(input.positionId);
if (positionSettled(position)) {
  console.log(`position_already_settled\t${input.positionId}`);
  process.exit(0);
}

const oracle = readObject(input.oracleId);
const settlement = oracleSettlementStatus(oracle);
if (!settlement.settled && !force) {
  console.log(`oracle_not_settled\t${input.oracleId}\texpiry=${settlement.expiryMs ?? 'unknown'}`);
} else {
  const args = buildSettleSamplePtbArgs(input, { execute });
  const result = parseSuiJsonOutput<JsonObject>(execFileSync('sui', args, { encoding: 'utf8' }));
  const digest =
    (result.digest as string | undefined) ??
    ((result.effects as { transactionDigest?: string } | undefined)?.transactionDigest as string | undefined);
  console.log(`${execute ? 'settle_execute' : 'settle_dry_run'}\t${digest ?? 'no-digest'}`);

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
          sampleSettleDigest: digest,
          sampleSettlePayout: event?.payout,
          sampleSettlePnlIsGain: event?.pnl_is_gain,
          sampleSettlePnlAbs: event?.pnl_abs,
        },
        null,
        2,
      )}\n`,
    );
  }
}
