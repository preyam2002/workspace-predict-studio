import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiObjectData } from '@mysten/sui/jsonRpc';
import { getOracles, type IndexerOracle } from './indexer';
import { FLOAT, type Leg, type OracleState, type SVI } from './types';

type MoveObjectFields = Record<string, unknown>;

export function decodeU64LE(bytes: number[] | Uint8Array): number {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let value = 0n;
  for (let i = 0; i < arr.length; i += 1) value += BigInt(arr[i]) << (8n * BigInt(i));
  return Number(value);
}

function getFields(data: SuiObjectData): MoveObjectFields {
  const content = data.content;
  if (!content || content.dataType !== 'moveObject') throw new Error('Expected move object content');
  return content.fields as MoveObjectFields;
}

function numeric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  throw new Error(`Expected numeric field, got ${typeof value}`);
}

function i64Float(value: unknown): number {
  const fields = (value as { fields?: { is_negative?: boolean; magnitude?: string } }).fields;
  if (!fields) throw new Error('Expected I64 field');
  const magnitude = Number(fields.magnitude) / FLOAT;
  return fields.is_negative ? -magnitude : magnitude;
}

function u64Float(value: unknown): number {
  return numeric(value) / FLOAT;
}

function parseSvi(value: unknown): SVI {
  const fields = (value as { fields?: MoveObjectFields }).fields;
  if (!fields) throw new Error('Expected SVI fields');
  return {
    a: u64Float(fields.a),
    b: u64Float(fields.b),
    rho: i64Float(fields.rho),
    m: i64Float(fields.m),
    sigma: u64Float(fields.sigma),
  };
}

function objectPackage(type: string): string {
  return type.split('::')[0];
}

export async function loadOracleState(
  client: SuiJsonRpcClient,
  options: {
    oracleId?: string;
    managerId?: string;
    dusdcType?: string;
  } = {},
): Promise<OracleState> {
  const oracles = await getOracles();
  const indexerOracle =
    (options.oracleId && oracles.find((oracle) => oracle.oracle_id === options.oracleId)) ??
    oracles.find((oracle) => oracle.status === 'active') ??
    oracles[0];

  if (!indexerOracle) throw new Error('No Predict oracles returned from indexer');

  const object = await client.getObject({
    id: indexerOracle.oracle_id,
    options: { showContent: true, showType: true },
  });
  if (!object.data) throw new Error(`Oracle object not found: ${indexerOracle.oracle_id}`);

  const fields = getFields(object.data);
  const prices = (fields.prices as { fields?: MoveObjectFields }).fields;
  if (!prices) throw new Error('Oracle object missing prices');

  return {
    predictId: indexerOracle.predict_id,
    oracleId: indexerOracle.oracle_id,
    dbpPackage: objectPackage(object.data.type ?? ''),
    dusdcType: options.dusdcType ?? process.env.NEXT_PUBLIC_DUSDC_TYPE ?? '',
    managerId: options.managerId ?? process.env.NEXT_PUBLIC_MANAGER_ID,
    expiryMs: numeric(fields.expiry ?? indexerOracle.expiry),
    nowMs: Date.now(),
    spot: numeric(prices.spot),
    forward: numeric(prices.forward),
    status: String(indexerOracle.status ?? (fields.active ? 'active' : 'settled')),
    settlementPrice: indexerOracle.settlement_price ? Number(indexerOracle.settlement_price) : undefined,
    underlyingAsset: String(fields.underlying_asset ?? indexerOracle.underlying_asset),
    svi: parseSvi(fields.svi),
    minStrike: Number(indexerOracle.min_strike),
    tickSize: Number(indexerOracle.tick_size),
    maxStrike: Math.max(
      Number(indexerOracle.min_strike) + Number(indexerOracle.tick_size) * 100_000,
      numeric(prices.spot) * 1.5,
    ),
  };
}

export class PredictClient {
  constructor(
    private readonly client: SuiJsonRpcClient,
    private readonly pkg: string,
    private readonly dbp: string,
  ) {}

  private legKeyCall(tx: Transaction, oracle: OracleState, leg: Leg) {
    if (leg.isRange) {
      return tx.moveCall({
        target: `${this.dbp}::range_key::new`,
        arguments: [
          tx.pure.id(oracle.oracleId),
          tx.pure.u64(oracle.expiryMs),
          tx.pure.u64(leg.lowerStrike),
          tx.pure.u64(leg.higherStrike),
        ],
      });
    }

    return tx.moveCall({
      target: `${this.dbp}::market_key::new`,
      arguments: [
        tx.pure.id(oracle.oracleId),
        tx.pure.u64(oracle.expiryMs),
        tx.pure.u64(leg.lowerStrike),
        tx.pure.bool(leg.isUp),
      ],
    });
  }

  async quoteLegPair(oracle: OracleState, leg: Leg, sender: string): Promise<{ ask: number; bid: number }> {
    const tx = new Transaction();
    const key = this.legKeyCall(tx, oracle, leg);
    const fn = leg.isRange ? 'get_range_trade_amounts' : 'get_trade_amounts';
    tx.moveCall({
      target: `${this.dbp}::predict::${fn}`,
      arguments: [
        tx.object(oracle.predictId),
        tx.object(oracle.oracleId),
        key,
        tx.pure.u64(leg.quantity),
        tx.object('0x6'),
      ],
    });

    const result = await this.client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const returnValues = result.results?.at(-1)?.returnValues;
    const askBytes = returnValues?.[0]?.[0];
    const bidBytes = returnValues?.[1]?.[0];
    if (!askBytes || !bidBytes) throw new Error('quoteLegPair: missing devInspect return values');
    return { ask: decodeU64LE(askBytes), bid: decodeU64LE(bidBytes) };
  }

  async quoteLeg(oracle: OracleState, leg: Leg, sender: string): Promise<number> {
    return (await this.quoteLegPair(oracle, leg, sender)).ask;
  }

  buildMintTx(oracle: OracleState, legs: Leg[], shape: string, maxLossBudget: number): Transaction {
    if (!oracle.managerId) throw new Error('Missing PredictManager id');
    if (!oracle.dusdcType) throw new Error('Missing dUSDC type');
    const tx = new Transaction();
    const legStructs = legs.map((leg) =>
      tx.moveCall({
        target: `${this.pkg}::studio::new_leg`,
        arguments: [
          tx.pure.bool(leg.isRange),
          tx.pure.bool(leg.isUp),
          tx.pure.u64(leg.lowerStrike),
          tx.pure.u64(leg.higherStrike),
          tx.pure.u64(leg.quantity),
        ],
      }),
    );
    const legVec = tx.makeMoveVec({ type: `${this.pkg}::studio::Leg`, elements: legStructs });

    tx.moveCall({
      target: `${this.pkg}::studio::build_and_mint_to_sender`,
      typeArguments: [oracle.dusdcType],
      arguments: [
        tx.object(oracle.predictId),
        tx.object(oracle.managerId),
        tx.object(oracle.oracleId),
        tx.pure.string(shape),
        legVec,
        tx.pure.u64(maxLossBudget),
        tx.object('0x6'),
      ],
    });
    return tx;
  }

  buildSettleTx(oracle: OracleState, positionId: string): Transaction {
    if (!oracle.managerId) throw new Error('Missing PredictManager id');
    if (!oracle.dusdcType) throw new Error('Missing dUSDC type');
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::studio::settle_to_receipt`,
      typeArguments: [oracle.dusdcType],
      arguments: [
        tx.object(oracle.predictId),
        tx.object(oracle.managerId),
        tx.object(oracle.oracleId),
        tx.object(positionId),
        tx.object('0x6'),
      ],
    });
    return tx;
  }

  async listPositions(owner: string): Promise<Array<{ objectId?: string }>> {
    const res = await this.client.getOwnedObjects({
      owner,
      filter: { StructType: `${this.pkg}::studio::StructuredPosition` },
      options: { showContent: true },
    });
    return res.data.flatMap((item) => {
      const data = item.data as { objectId?: string } | null | undefined;
      return data ? [data] : [];
    });
  }
}

export function indexerOracleToConfig(oracle: IndexerOracle, dbpPackage: string) {
  return {
    predictId: oracle.predict_id,
    oracleId: oracle.oracle_id,
    dbp: dbpPackage,
    expiry: oracle.expiry,
    minStrike: oracle.min_strike,
    tickSize: oracle.tick_size,
  };
}
