import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { existsSync, readFileSync } from 'node:fs';

if (!existsSync('./scripts/config.json')) {
  throw new Error('Missing scripts/config.json. Run `pnpm verify:first -- --write-config`, then fill managerId, dusdcType, dusdcCoinId, and sender.');
}

const cfg = JSON.parse(readFileSync('./scripts/config.json', 'utf8')) as {
  dbp: string;
  predictId: string;
  managerId: string;
  oracleId: string;
  dusdcType: string;
  sender: string;
  expiry: number;
  minStrike: number;
  tickSize: number;
  atmStrike?: number;
};

for (const key of ['dbp', 'predictId', 'managerId', 'oracleId', 'dusdcType', 'sender', 'expiry', 'minStrike', 'tickSize'] as const) {
  if (!cfg[key] || String(cfg[key]).startsWith('replace-')) {
    throw new Error(`scripts/config.json is missing ${key}. Run \`pnpm verify:first -- --write-config\` and \`pnpm setup\` first.`);
  }
}

const client = new SuiJsonRpcClient({ url: process.env.SUI_RPC ?? getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
const sizes = [1, 3, 5, 8, 10, 12, 15, 20];
let maxSafe = 0;
let maxTestedSuccess = 0;

for (const n of sizes) {
  const tx = new Transaction();
  const center = cfg.atmStrike ?? cfg.minStrike + cfg.tickSize;
  for (let i = 0; i < n; i += 1) {
    const offset = i - Math.floor(n / 2);
    const strike = Math.max(cfg.minStrike + cfg.tickSize, center + offset * cfg.tickSize);
    const key = tx.moveCall({
      target: `${cfg.dbp}::market_key::up`,
      arguments: [tx.pure.id(cfg.oracleId), tx.pure.u64(cfg.expiry), tx.pure.u64(strike)],
    });
    tx.moveCall({
      target: `${cfg.dbp}::predict::mint`,
      typeArguments: [cfg.dusdcType],
      arguments: [
        tx.object(cfg.predictId),
        tx.object(cfg.managerId),
        tx.object(cfg.oracleId),
        key,
        tx.pure.u64(1_000_000),
        tx.object('0x6'),
      ],
    });
  }

  const result = await client.devInspectTransactionBlock({ sender: cfg.sender, transactionBlock: tx });
  const computation = Number(result.effects?.gasUsed?.computationCost ?? 0);
  const status = result.effects?.status.status ?? 'unknown';
  if (status === 'success') maxTestedSuccess = n;
  if (status === 'success' && computation < 5_000_000) maxSafe = n;
  console.log(`${n}\t${computation}\t${status}${result.effects?.status.error ? `\t${result.effects.status.error}` : ''}`);
}

console.log(`MAX_SPONSORED_LEGS_UNDER_5M=${maxSafe || 0}`);
console.log(`MAX_TESTED_LEGS_PER_PTB=${maxTestedSuccess}`);
