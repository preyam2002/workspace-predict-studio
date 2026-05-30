import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { decodeU64LE } from './predict-client';

export interface VaultIds {
  vaultId: string;
  quoteType: string;
  recipient: string;
}

export interface CreateVaultParams {
  factoryId: string;
  quoteType: string;
  managerOwner: string;
  minDeposit: number;
  performanceFeeBps: number;
  strategy: string;
}

export interface CreateVaultWithManagerEscrowParams {
  factoryId: string;
  quoteType: string;
  managerId: string;
  recipient: string;
  minDeposit: number;
  performanceFeeBps: number;
  strategy: string;
}

export class VaultClient {
  constructor(
    private readonly client: SuiJsonRpcClient,
    private readonly pkg: string,
  ) {}

  buildDepositTx(ids: VaultIds, coinId: string): Transaction {
    const tx = new Transaction();
    const shares = tx.moveCall({
      target: `${this.pkg}::vault::deposit`,
      typeArguments: [ids.quoteType],
      arguments: [tx.object(ids.vaultId), tx.object(coinId)],
    });
    tx.transferObjects([shares], tx.pure.address(ids.recipient));
    return tx;
  }

  buildRequestDepositTx(ids: VaultIds, coinId: string): Transaction {
    const tx = new Transaction();
    const receipt = tx.moveCall({
      target: `${this.pkg}::vault::request_deposit`,
      typeArguments: [ids.quoteType],
      arguments: [tx.object(ids.vaultId), tx.object(coinId)],
    });
    tx.transferObjects([receipt], tx.pure.address(ids.recipient));
    return tx;
  }

  buildWithdrawTx(ids: VaultIds, shareCoinId: string): Transaction {
    const tx = new Transaction();
    const assets = tx.moveCall({
      target: `${this.pkg}::vault::withdraw`,
      typeArguments: [ids.quoteType],
      arguments: [tx.object(ids.vaultId), tx.object(shareCoinId)],
    });
    tx.transferObjects([assets], tx.pure.address(ids.recipient));
    return tx;
  }

  buildClaimTx(ids: VaultIds, receiptId: string): Transaction {
    const tx = new Transaction();
    const shares = tx.moveCall({
      target: `${this.pkg}::vault::claim`,
      typeArguments: [ids.quoteType],
      arguments: [tx.object(ids.vaultId), tx.object(receiptId)],
    });
    tx.transferObjects([shares], tx.pure.address(ids.recipient));
    return tx;
  }

  buildKeeperRollTx(vaultId: string, quoteType: string, keeperCapId: string, budget: number): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::vault::keeper_roll`,
      typeArguments: [quoteType],
      arguments: [tx.object(vaultId), tx.object(keeperCapId), tx.pure.u64(budget)],
    });
    return tx;
  }

  buildCreateManagerEscrowTx(ids: VaultIds, managerId: string): Transaction {
    const tx = new Transaction();
    const escrow = tx.moveCall({
      target: `${this.pkg}::vault::create_manager_escrow`,
      typeArguments: [ids.quoteType],
      arguments: [tx.object(ids.vaultId), tx.object(managerId)],
    });
    tx.transferObjects([escrow], tx.pure.address(ids.recipient));
    return tx;
  }

  buildCreateAndShareVaultTx(params: CreateVaultParams): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::vault::create_and_share_vault`,
      typeArguments: [params.quoteType],
      arguments: [
        tx.object(params.factoryId),
        tx.pure.address(params.managerOwner),
        tx.pure.u64(params.minDeposit),
        tx.pure.u64(params.performanceFeeBps),
        tx.pure.string(params.strategy),
      ],
    });
    return tx;
  }

  buildCreateVaultWithManagerEscrowTx(params: CreateVaultWithManagerEscrowParams): Transaction {
    const tx = new Transaction();
    const escrow = tx.moveCall({
      target: `${this.pkg}::vault::create_and_share_vault_with_manager_escrow`,
      typeArguments: [params.quoteType],
      arguments: [
        tx.object(params.factoryId),
        tx.object(params.managerId),
        tx.pure.u64(params.minDeposit),
        tx.pure.u64(params.performanceFeeBps),
        tx.pure.string(params.strategy),
      ],
    });
    tx.transferObjects([escrow], tx.pure.address(params.recipient));
    return tx;
  }

  async readNav(vaultId: string, quoteType: string, sender: string): Promise<number> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::vault::nav`,
      typeArguments: [quoteType],
      arguments: [tx.object(vaultId)],
    });
    const result = await this.client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const navBytes = result.results?.at(-1)?.returnValues?.[0]?.[0];
    if (!navBytes) throw new Error('readNav: missing devInspect return value');
    return decodeU64LE(navBytes);
  }
}
