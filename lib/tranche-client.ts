import { Transaction } from '@mysten/sui/transactions';

export interface TrancheIds {
  trancheVaultId: string;
  recipient: string;
}

export interface SettleTrancheParams {
  trancheVaultId: string;
  vaultId: string;
  oracleId: string;
}

export class TrancheClient {
  constructor(private readonly pkg: string) {}

  buildSplitTx(ids: TrancheIds, shareCoinId: string): Transaction {
    const tx = new Transaction();
    const [pt, yt] = tx.moveCall({
      target: `${this.pkg}::pt_yt::split`,
      arguments: [tx.object(ids.trancheVaultId), tx.object(shareCoinId)],
    });
    tx.transferObjects([pt, yt], tx.pure.address(ids.recipient));
    return tx;
  }

  buildMergeTx(ids: TrancheIds, ptCoinId: string, ytCoinId: string): Transaction {
    const tx = new Transaction();
    const shares = tx.moveCall({
      target: `${this.pkg}::pt_yt::merge`,
      arguments: [tx.object(ids.trancheVaultId), tx.object(ptCoinId), tx.object(ytCoinId)],
    });
    tx.transferObjects([shares], tx.pure.address(ids.recipient));
    return tx;
  }

  buildRedeemPtTx(ids: TrancheIds, ptCoinId: string): Transaction {
    const tx = new Transaction();
    const assets = tx.moveCall({
      target: `${this.pkg}::pt_yt::redeem_pt`,
      arguments: [tx.object(ids.trancheVaultId), tx.object(ptCoinId)],
    });
    tx.transferObjects([assets], tx.pure.address(ids.recipient));
    return tx;
  }

  buildRedeemYtTx(ids: TrancheIds, ytCoinId: string): Transaction {
    const tx = new Transaction();
    const assets = tx.moveCall({
      target: `${this.pkg}::pt_yt::redeem_yt`,
      arguments: [tx.object(ids.trancheVaultId), tx.object(ytCoinId)],
    });
    tx.transferObjects([assets], tx.pure.address(ids.recipient));
    return tx;
  }

  buildSettleTx(params: SettleTrancheParams): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::pt_yt::settle_tranche`,
      arguments: [tx.object(params.trancheVaultId), tx.object(params.vaultId), tx.object(params.oracleId), tx.object('0x6')],
    });
    return tx;
  }
}
