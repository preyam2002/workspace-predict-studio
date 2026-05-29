export const PREDICT_INDEXER_BASE = 'https://predict-server.testnet.mystenlabs.com';

export interface IndexerOracle {
  predict_id: string;
  oracle_id: string;
  oracle_cap_id?: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: string;
  activated_at?: number;
  settlement_price?: number;
  settled_at?: number;
  created_checkpoint?: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${PREDICT_INDEXER_BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function getOracles(): Promise<IndexerOracle[]> {
  return get<IndexerOracle[]>('/oracles');
}

export function getManagerPositions(id: string) {
  return get(`/managers/${id}/positions/summary`);
}

export function getManagerPnl(id: string) {
  return get(`/managers/${id}/pnl`);
}

export async function getPrices(oracleId: string) {
  const oracles = await getOracles();
  const oracle = oracles.find((item) => item.oracle_id === oracleId);
  if (!oracle) throw new Error(`oracle not found in /oracles: ${oracleId}`);
  return oracle;
}

export async function getSettledHistory(asset = 'BTC') {
  const oracles = await getOracles();
  return oracles
    .filter((oracle) => oracle.underlying_asset === asset && oracle.status === 'settled' && oracle.settlement_price)
    .map((oracle) => ({ settlementPrice: Number(oracle.settlement_price), expiryMs: Number(oracle.expiry) }));
}
