import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import type { Leg } from './types';

type MoveObjectLike = { objectId?: string; content?: { dataType?: string; fields?: Record<string, unknown> } };

export interface CollateralMarketIds {
  marketId: string;
  recipient: string;
}

export interface NoteBorrowSummary {
  objectId: string;
  marketId?: string;
  owner?: string;
  floorValue: number;
  debt: number;
}

export function noteBorrowFromObject(data: MoveObjectLike): NoteBorrowSummary | undefined {
  if (!data.objectId || data.content?.dataType !== 'moveObject' || !data.content.fields) return undefined;
  const fields = data.content.fields;
  const floorValue = Number(fields.floor_value);
  const debt = Number(fields.debt);
  if (!Number.isFinite(floorValue) || !Number.isFinite(debt)) return undefined;
  return {
    objectId: data.objectId,
    marketId: typeof fields.market_id === 'string' ? fields.market_id : undefined,
    owner: typeof fields.owner === 'string' ? fields.owner : undefined,
    floorValue,
    debt,
  };
}

export async function listNoteBorrows(
  client: Pick<SuiJsonRpcClient, 'getOwnedObjects'>,
  owner: string,
  pkg: string,
  dusdcType: string,
): Promise<NoteBorrowSummary[]> {
  const res = await client.getOwnedObjects({
    owner,
    filter: { StructType: `${pkg}::studio_collateral::NoteBorrow<${dusdcType}>` },
    options: { showContent: true },
  });
  return res.data.flatMap((item) => {
    const loan = noteBorrowFromObject(item.data as MoveObjectLike);
    return loan ? [loan] : [];
  });
}

/** Everything needed to repay an outstanding note loan and reclaim the note in a single PTB. */
export interface RepayAndReclaimParams {
  marketId: string;
  dusdcType: string;
  positionId: string;
  /** dUSDC payment coins; the first is primary, the rest are merged into it before the exact-debt split. */
  paymentCoinIds: string[];
  debtAmount: number;
  recipient: string;
}

/** Everything needed to mint a note and borrow against it in a single PTB. */
export interface MintAndBorrowParams {
  marketId: string;
  predictId: string;
  managerId: string;
  oracleId: string;
  dusdcType: string;
  shape: string;
  legs: Leg[];
  maxLossBudget: number;
  borrowAmount: number;
  recipient: string;
}

export class CollateralClient {
  constructor(private readonly pkg: string) {}

  buildDepositLiquidityTx(ids: CollateralMarketIds, dusdcCoinId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::studio_collateral::deposit_liquidity`,
      arguments: [tx.object(ids.marketId), tx.object(dusdcCoinId)],
    });
    return tx;
  }

  buildOpenPositionTx(ids: CollateralMarketIds, vaultId: string, shareCoinId: string, floorValue: number): Transaction {
    const tx = new Transaction();
    const position = tx.moveCall({
      target: `${this.pkg}::studio_collateral::open_position`,
      arguments: [tx.object(ids.marketId), tx.object(vaultId), tx.object(shareCoinId), tx.pure.u64(floorValue)],
    });
    tx.transferObjects([position], tx.pure.address(ids.recipient));
    return tx;
  }

  buildBorrowTx(ids: CollateralMarketIds, positionId: string, amount: number): Transaction {
    const tx = new Transaction();
    const coin = tx.moveCall({
      target: `${this.pkg}::studio_collateral::borrow`,
      arguments: [tx.object(ids.marketId), tx.object(positionId), tx.pure.u64(amount)],
    });
    tx.transferObjects([coin], tx.pure.address(ids.recipient));
    return tx;
  }

  buildRepayTx(marketId: string, positionId: string, dusdcCoinId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::studio_collateral::repay`,
      arguments: [tx.object(marketId), tx.object(positionId), tx.object(dusdcCoinId)],
    });
    return tx;
  }

  buildCloseTx(ids: CollateralMarketIds, positionId: string): Transaction {
    const tx = new Transaction();
    const collateral = tx.moveCall({
      target: `${this.pkg}::studio_collateral::close`,
      arguments: [tx.object(ids.marketId), tx.object(positionId)],
    });
    tx.transferObjects([collateral], tx.pure.address(ids.recipient));
    return tx;
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

  /**
   * One PTB: mint a defined-risk note, lock it as collateral, and borrow against its
   * provable value — the note never leaves the transaction. The composability climax.
   */
  buildMintAndBorrowTx(p: MintAndBorrowParams): Transaction {
    const tx = new Transaction();
    const legVec = this.legVec(tx, p.legs);

    const note = tx.moveCall({
      target: `${this.pkg}::studio::build_and_mint`,
      typeArguments: [p.dusdcType],
      arguments: [
        tx.object(p.predictId),
        tx.object(p.managerId),
        tx.object(p.oracleId),
        tx.pure.string(p.shape),
        legVec,
        tx.pure.u64(p.maxLossBudget),
        tx.object('0x6'),
      ],
    });

    const position = tx.moveCall({
      target: `${this.pkg}::studio_collateral::open_note_position`,
      typeArguments: [p.dusdcType],
      arguments: [tx.object(p.marketId), note, tx.object(p.predictId), tx.object(p.oracleId), tx.object('0x6')],
    });

    const borrowed = tx.moveCall({
      target: `${this.pkg}::studio_collateral::borrow_note`,
      typeArguments: [p.dusdcType],
      arguments: [tx.object(p.marketId), position, tx.pure.u64(p.borrowAmount)],
    });

    tx.transferObjects([borrowed], tx.pure.address(p.recipient));
    tx.transferObjects([position], tx.pure.address(p.recipient));
    return tx;
  }

  /** One PTB: repay the exact outstanding debt, then take the escrowed note back verbatim. */
  buildRepayAndReclaimTx(p: RepayAndReclaimParams): Transaction {
    const tx = new Transaction();
    if (p.debtAmount > 0) {
      const [primary, ...rest] = p.paymentCoinIds;
      if (!primary) throw new Error('A dUSDC payment coin is required to repay outstanding debt');
      if (rest.length > 0) tx.mergeCoins(tx.object(primary), rest.map((id) => tx.object(id)));
      const [payment] = tx.splitCoins(tx.object(primary), [p.debtAmount]);
      tx.moveCall({
        target: `${this.pkg}::studio_collateral::repay_note`,
        typeArguments: [p.dusdcType],
        arguments: [tx.object(p.marketId), tx.object(p.positionId), payment],
      });
    }
    const note = tx.moveCall({
      target: `${this.pkg}::studio_collateral::close_note`,
      typeArguments: [p.dusdcType],
      arguments: [tx.object(p.positionId)],
    });
    tx.transferObjects([note], tx.pure.address(p.recipient));
    return tx;
  }

  /** Reclaim a debt-free note: `close_note` aborts on-chain unless debt is zero. */
  buildCloseNoteTx(ids: CollateralMarketIds, dusdcType: string, positionId: string): Transaction {
    const tx = new Transaction();
    const note = tx.moveCall({
      target: `${this.pkg}::studio_collateral::close_note`,
      typeArguments: [dusdcType],
      arguments: [tx.object(positionId)],
    });
    tx.transferObjects([note], tx.pure.address(ids.recipient));
    return tx;
  }
}
