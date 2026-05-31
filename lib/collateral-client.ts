import { Transaction } from '@mysten/sui/transactions';

export interface CollateralMarketIds {
  marketId: string;
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
}
