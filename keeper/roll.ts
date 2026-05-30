import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadOracleState } from '../lib/predict-client';
import { priceUp } from '../lib/payoff';
import type { OracleState } from '../lib/types';
import { VaultClient } from '../lib/vault-client';

export interface DeltaBand {
  downsideDelta: number;
  upsideDelta: number;
}

export interface AskBounds {
  minAsk: number;
  maxAsk: number;
}

export interface KeeperRollPlan {
  action: 'wait' | 'roll';
  lowerStrike: number;
  higherStrike: number;
  budget: number;
}

export interface KeeperConfig extends DeltaBand {
  studioPackage?: string;
  vaultId: string;
  keeperCapId: string;
  quoteType: string;
  budget: number;
  oracleId?: string;
  sender?: string;
  dryRun?: boolean;
  askBounds?: AskBounds;
}

function grid(oracle: Pick<OracleState, 'minStrike' | 'maxStrike' | 'tickSize'>): number[] {
  const out: number[] = [];
  for (let k = oracle.minStrike; k <= oracle.maxStrike; k += oracle.tickSize) out.push(k);
  return out;
}

function withinBounds(probability: number, bounds?: AskBounds): boolean {
  if (!bounds) return true;
  return probability >= bounds.minAsk && probability <= bounds.maxAsk;
}

export function chooseStrikeForUpProbability(
  oracle: OracleState,
  targetUpProbability: number,
  bounds?: AskBounds,
): number {
  let best = oracle.minStrike;
  let bestErr = Number.POSITIVE_INFINITY;
  const strikes = grid(oracle);
  const bounded = strikes.filter((strike) => withinBounds(priceUp(oracle.svi, oracle.forward, strike), bounds));
  for (const strike of bounded.length > 0 ? bounded : strikes) {
    const upProbability = priceUp(oracle.svi, oracle.forward, strike);
    const err = Math.abs(upProbability - targetUpProbability);
    if (err < bestErr) {
      bestErr = err;
      best = strike;
    }
  }
  return best;
}

export function selectRangeBand(
  oracle: OracleState,
  band: DeltaBand,
  bounds?: AskBounds,
): { lowerStrike: number; higherStrike: number } {
  const lowerStrike = chooseStrikeForUpProbability(oracle, 1 - band.downsideDelta, bounds);
  const higherStrike = chooseStrikeForUpProbability(oracle, band.upsideDelta, bounds);
  return {
    lowerStrike: Math.min(lowerStrike, higherStrike - oracle.tickSize),
    higherStrike: Math.max(higherStrike, lowerStrike + oracle.tickSize),
  };
}

export function planKeeperRoll(
  oracle: OracleState,
  band: DeltaBand,
  budget: number,
  nowMs = Date.now(),
  bounds?: AskBounds,
): KeeperRollPlan {
  const strikes = selectRangeBand(oracle, band, bounds);
  if (oracle.status === 'active' && nowMs < oracle.expiryMs) {
    return { action: 'wait', ...strikes, budget };
  }
  return { action: 'roll', ...strikes, budget };
}

export function buildKeeperRollDryRun(config: KeeperConfig, oracle: OracleState) {
  const plan = planKeeperRoll(
    oracle,
    { downsideDelta: config.downsideDelta, upsideDelta: config.upsideDelta },
    config.budget,
    Date.now(),
    config.askBounds,
  );
  if (plan.action === 'wait') return { plan, tx: undefined };

  const studioPackage = config.studioPackage ?? process.env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE;
  if (!studioPackage) throw new Error('keeper config is missing studioPackage');
  const tx = new VaultClient({} as never, studioPackage).buildKeeperRollTx(
    config.vaultId,
    config.quoteType,
    config.keeperCapId,
    config.budget,
  );
  return { plan, tx };
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
}

function configPath(): string {
  const arg = process.argv.find((item) => item.startsWith('--config='));
  return arg?.slice('--config='.length) || './keeper/config.json';
}

async function main() {
  const path = configPath();
  if (!existsSync(path)) throw new Error(`Missing ${path}. Copy keeper/config.example.json and fill vault/keeper ids.`);
  const config = JSON.parse(readFileSync(path, 'utf8')) as KeeperConfig;
  const client = new SuiJsonRpcClient({
    url: process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet'),
    network: 'testnet',
  });
  const oracle = await loadOracleState(client, { oracleId: config.oracleId, dusdcType: config.quoteType });
  const { plan, tx } = buildKeeperRollDryRun(config, oracle);

  console.log(`keeper\t${plan.action}\tlower=${plan.lowerStrike}\thigher=${plan.higherStrike}\tbudget=${plan.budget}`);
  if (tx) console.log(json(tx.getData()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
