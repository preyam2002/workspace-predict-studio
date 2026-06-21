import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiObjectData } from '@mysten/sui/jsonRpc';
import { getOracles, type IndexerOracle } from './indexer';
import type { RfqQuote } from './rfq';
import { FLOAT, type Leg, type OracleState, type SVI } from './types';

type MoveObjectFields = Record<string, unknown>;
type MoveObjectLike = { objectId?: string; content?: { dataType?: string; fields?: MoveObjectFields } };
type SettleOracleConfig = Pick<OracleState, 'predictId' | 'managerId' | 'oracleId' | 'dusdcType'>;
type TransactionEventsLike = { events?: Array<{ type?: string; parsedJson?: unknown }> | null };

export interface StructuredPositionSummary {
  objectId: string;
  owner?: string;
  managerId?: string;
  oracleId?: string;
  expiryMs: number;
  shape: string;
  legs: Leg[];
  premiumPaid: number;
  maxLoss: number;
  maxGain: number;
  settled: boolean;
}

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

function optionalNumeric(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return numeric(value);
}

function idString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const fields = (value as { fields?: { id?: string; bytes?: string } } | undefined)?.fields;
  return fields?.id ?? fields?.bytes;
}

function moveString(value: unknown): string {
  if (typeof value === 'string') return value;
  const fields = (value as { fields?: { bytes?: unknown } } | undefined)?.fields;
  const bytes = fields?.bytes;
  if (Array.isArray(bytes)) return new TextDecoder().decode(Uint8Array.from(bytes.map(Number)));
  if (typeof bytes === 'string') return bytes;
  return String(value ?? '');
}

function legFromFields(value: unknown): Leg {
  const fields = (value as { fields?: MoveObjectFields } | undefined)?.fields ?? (value as MoveObjectFields);
  return {
    isRange: Boolean(fields.is_range),
    isUp: Boolean(fields.is_up),
    lowerStrike: numeric(fields.lower_strike),
    higherStrike: numeric(fields.higher_strike),
    quantity: numeric(fields.quantity),
  };
}

export function structuredPositionFromObject(data: MoveObjectLike): StructuredPositionSummary | undefined {
  if (!data.objectId || data.content?.dataType !== 'moveObject' || !data.content.fields) return undefined;
  const fields = data.content.fields;
  const expiryMs = optionalNumeric(fields.expiry_ms);
  const premiumPaid = optionalNumeric(fields.premium_paid);
  const maxLoss = optionalNumeric(fields.max_loss);
  const maxGain = optionalNumeric(fields.max_gain);
  if (expiryMs === undefined || premiumPaid === undefined || maxLoss === undefined || maxGain === undefined) return undefined;

  const legs = Array.isArray(fields.legs) ? fields.legs.map(legFromFields) : [];
  return {
    objectId: data.objectId,
    owner: typeof fields.owner === 'string' ? fields.owner : undefined,
    managerId: idString(fields.manager_id),
    oracleId: idString(fields.oracle_id),
    expiryMs,
    shape: moveString(fields.shape),
    legs,
    premiumPaid,
    maxLoss,
    maxGain,
    settled: Boolean(fields.settled),
  };
}

export function managerIdFromTransaction(transaction: TransactionEventsLike): string | undefined {
  const event = transaction.events?.find((item) => item.type?.endsWith('::predict_manager::PredictManagerCreated'));
  const managerId = (event?.parsedJson as { manager_id?: unknown } | undefined)?.manager_id;
  return typeof managerId === 'string' ? managerId : undefined;
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

export function isLiveOracleState(oracle: Pick<OracleState, 'status' | 'expiryMs'>, nowMs = Date.now()): boolean {
  return oracle.status === 'active' && oracle.expiryMs > nowMs;
}

function isLiveIndexerOracle(oracle: IndexerOracle, nowMs: number): boolean {
  return oracle.status === 'active' && Number(oracle.expiry) > nowMs;
}

export function selectLiveIndexerOracle(oracles: IndexerOracle[], preferredOracleId?: string, nowMs = Date.now()): IndexerOracle | undefined {
  const preferred = preferredOracleId ? oracles.find((oracle) => oracle.oracle_id === preferredOracleId) : undefined;
  if (preferred && isLiveIndexerOracle(preferred, nowMs)) return preferred;
  return oracles.find((oracle) => isLiveIndexerOracle(oracle, nowMs)) ?? preferred ?? oracles[0];
}

export async function getManagerOwner(client: SuiJsonRpcClient, managerId: string): Promise<string | undefined> {
  const object = await client.getObject({
    id: managerId,
    options: { showContent: true },
  });
  const content = object.data?.content;
  if (!content || content.dataType !== 'moveObject') return undefined;
  const owner = (content.fields as MoveObjectFields | undefined)?.owner;
  return typeof owner === 'string' ? owner : undefined;
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
  const indexerOracle = selectLiveIndexerOracle(oracles, options.oracleId);

  if (!indexerOracle) throw new Error('No Predict oracles returned from indexer');

  const object = await client.getObject({
    id: indexerOracle.oracle_id,
    options: { showContent: true, showType: true },
  });
  if (!object.data) throw new Error(`Oracle object not found: ${indexerOracle.oracle_id}`);

  const fields = getFields(object.data);
  const prices = (fields.prices as { fields?: MoveObjectFields }).fields;
  if (!prices) throw new Error('Oracle object missing prices');
  const exposedMaxStrike = optionalNumeric(fields.max_strike ?? indexerOracle.max_strike);

  return {
    predictId: indexerOracle.predict_id,
    oracleId: indexerOracle.oracle_id,
    dbpPackage: objectPackage(object.data.type ?? ''),
    dusdcType: options.dusdcType ?? process.env.NEXT_PUBLIC_DUSDC_TYPE ?? '',
    managerId: options.managerId,
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
    // The DeepBook Predict oracle exposes min_strike + tick_size but no hard max_strike
    // (confirmed live: the on-chain OracleSVI has no max_strike field). When neither the
    // object nor the indexer reports one, derive a sane upper grid cap for strike snapping
    // from real oracle data (min_strike + 100k ticks, or 1.5x spot) — a UI bound only, never
    // surfaced as a price or NAV.
    maxStrike:
      exposedMaxStrike ??
      Math.max(Number(indexerOracle.min_strike) + Number(indexerOracle.tick_size) * 100_000, numeric(prices.spot) * 1.5),
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

  private legVec(tx: Transaction, legs: Leg[]) {
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
    return tx.makeMoveVec({ type: `${this.pkg}::studio::Leg`, elements: legStructs });
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

  async getManagerBalance(oracle: Pick<OracleState, 'managerId' | 'dusdcType'>, sender: string): Promise<number> {
    if (!oracle.managerId) throw new Error('Missing PredictManager id');
    if (!oracle.dusdcType) throw new Error('Missing dUSDC type');
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.dbp}::predict_manager::balance`,
      typeArguments: [oracle.dusdcType],
      arguments: [tx.object(oracle.managerId)],
    });

    const result = await this.client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const balanceBytes = result.results?.at(-1)?.returnValues?.[0]?.[0];
    if (!balanceBytes) throw new Error('getManagerBalance: missing devInspect return value');
    return decodeU64LE(balanceBytes);
  }

  buildCreateManagerTx(): Transaction {
    const tx = new Transaction();
    tx.moveCall({ target: `${this.dbp}::predict::create_manager`, arguments: [] });
    return tx;
  }

  buildDepositManagerTx(oracle: Pick<OracleState, 'managerId' | 'dusdcType'>, coinId: string, amount?: number): Transaction {
    if (!oracle.managerId) throw new Error('Missing PredictManager id');
    if (!oracle.dusdcType) throw new Error('Missing dUSDC type');
    const tx = new Transaction();
    const coin = amount === undefined ? tx.object(coinId) : tx.splitCoins(tx.object(coinId), [tx.pure.u64(BigInt(amount))]);
    tx.moveCall({
      target: `${this.dbp}::predict_manager::deposit`,
      typeArguments: [oracle.dusdcType],
      arguments: [tx.object(oracle.managerId), coin],
    });
    return tx;
  }

  buildWithdrawManagerTx(oracle: Pick<OracleState, 'managerId' | 'dusdcType'>, amount: number, recipient: string): Transaction {
    if (!oracle.managerId) throw new Error('Missing PredictManager id');
    if (!oracle.dusdcType) throw new Error('Missing dUSDC type');
    if (amount <= 0) throw new Error('Withdraw amount must be positive');
    const tx = new Transaction();
    const coin = tx.moveCall({
      target: `${this.dbp}::predict_manager::withdraw`,
      typeArguments: [oracle.dusdcType],
      arguments: [tx.object(oracle.managerId), tx.pure.u64(BigInt(amount))],
    });
    tx.transferObjects([coin], recipient);
    return tx;
  }

  buildMintTx(oracle: OracleState, legs: Leg[], shape: string, maxLossBudget: number): Transaction {
    if (!oracle.managerId) throw new Error('Missing PredictManager id');
    if (!oracle.dusdcType) throw new Error('Missing dUSDC type');
    const tx = new Transaction();
    const legVec = this.legVec(tx, legs);

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

  buildFillQuoteTx(
    oracle: OracleState,
    rfqBookId: string,
    legs: Leg[],
    shape: string,
    quote: RfqQuote,
    publicKey: Uint8Array | number[],
    signature: Uint8Array | number[],
    recipient: string,
  ): Transaction {
    if (!oracle.managerId) throw new Error('Missing PredictManager id');
    if (!oracle.dusdcType) throw new Error('Missing dUSDC type');
    const tx = new Transaction();
    const legVec = this.legVec(tx, legs);
    const quoteArg = tx.moveCall({
      target: `${this.pkg}::rfq::new_quote`,
      arguments: [
        tx.pure.vector('u8', Array.from(quote.structureHash)),
        tx.pure.u64(quote.premium),
        tx.pure.address(quote.maker),
        tx.pure.u64(quote.expiryMs),
        tx.pure.u64(quote.nonce),
      ],
    });

    // fill_quote returns the minted StructuredPosition by value; it has `key, store` but
    // no `drop`, so the PTB must transfer it or the transaction is rejected.
    const position = tx.moveCall({
      target: `${this.pkg}::rfq::fill_quote`,
      typeArguments: [oracle.dusdcType],
      arguments: [
        tx.object(rfqBookId),
        tx.object(oracle.predictId),
        tx.object(oracle.managerId),
        tx.object(oracle.oracleId),
        tx.pure.string(shape),
        legVec,
        quoteArg,
        tx.pure.vector('u8', Array.from(publicKey)),
        tx.pure.vector('u8', Array.from(signature)),
        tx.object('0x6'),
      ],
    });
    tx.transferObjects([position], recipient);
    return tx;
  }

  buildSettleTx(oracle: SettleOracleConfig, positionId: string): Transaction {
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

  async listPositions(owner: string): Promise<StructuredPositionSummary[]> {
    const res = await this.client.getOwnedObjects({
      owner,
      filter: { StructType: `${this.pkg}::studio::StructuredPosition` },
      options: { showContent: true },
    });
    return res.data.flatMap((item) => {
      const position = structuredPositionFromObject(item.data as MoveObjectLike);
      return position ? [position] : [];
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
