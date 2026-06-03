import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { decodeU64LE } from './predict-client';
import type { Leg } from './types';

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

export interface RollIntoStrategyParams {
  vaultId: string;
  managerEscrowId: string;
  quoteType: string;
  predictId: string;
  managerId: string;
  oracleId: string;
  shape: string;
  legs: Leg[];
  maxLossBudget: number;
}

export interface FundManagerParams {
  vaultId: string;
  managerEscrowId: string;
  managerId: string;
  quoteType: string;
  amount: number;
}

export interface KeeperSettleParams {
  vaultId: string;
  keeperCapId: string;
  managerEscrowId: string;
  quoteType: string;
  predictId: string;
  managerId: string;
  oracleId: string;
}

export interface KeeperRollIntoStrategyParams extends RollIntoStrategyParams {
  keeperCapId: string;
  budget: number;
  fundAmount?: number;
}

export class VaultClient {
  constructor(
    private readonly client: SuiJsonRpcClient,
    private readonly pkg: string,
  ) {}

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

  buildKeeperSettleTx(params: KeeperSettleParams): Transaction {
    const tx = new Transaction();
    this.addKeeperSettle(tx, params);
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

  buildRollIntoStrategyTx(params: RollIntoStrategyParams): Transaction {
    const tx = new Transaction();
    this.addRollIntoStrategy(tx, params);
    return tx;
  }

  buildFundManagerTx(params: FundManagerParams): Transaction {
    const tx = new Transaction();
    this.addFundManager(tx, params);
    return tx;
  }

  buildKeeperRollIntoStrategyTx(params: KeeperRollIntoStrategyParams): Transaction {
    const tx = new Transaction();
    const vault = tx.object(params.vaultId);
    tx.moveCall({
      target: `${this.pkg}::vault::keeper_roll`,
      typeArguments: [params.quoteType],
      arguments: [vault, tx.object(params.keeperCapId), tx.pure.u64(params.budget)],
    });
    if (params.fundAmount && params.fundAmount > 0) {
      this.addFundManager(tx, { ...params, amount: params.fundAmount }, vault);
    }
    this.addRollIntoStrategy(tx, params, vault);
    return tx;
  }

  private addKeeperSettle(tx: Transaction, params: KeeperSettleParams, vault = tx.object(params.vaultId)) {
    tx.moveCall({
      target: `${this.pkg}::vault::keeper_settle`,
      typeArguments: [params.quoteType],
      arguments: [
        vault,
        tx.object(params.keeperCapId),
        tx.object(params.managerEscrowId),
        tx.object(params.predictId),
        tx.object(params.managerId),
        tx.object(params.oracleId),
        tx.object('0x6'),
      ],
    });
  }

  private addFundManager(tx: Transaction, params: FundManagerParams, vault = tx.object(params.vaultId)) {
    tx.moveCall({
      target: `${this.pkg}::vault::fund_manager_from_idle`,
      typeArguments: [params.quoteType],
      arguments: [
        vault,
        tx.object(params.managerEscrowId),
        tx.object(params.managerId),
        tx.pure.u64(params.amount),
      ],
    });
  }

  private addRollIntoStrategy(tx: Transaction, params: RollIntoStrategyParams, vault = tx.object(params.vaultId)) {
    const legs = this.legVec(tx, params.legs);
    tx.moveCall({
      target: `${this.pkg}::vault::roll_into_strategy`,
      typeArguments: [params.quoteType],
      arguments: [
        vault,
        tx.object(params.managerEscrowId),
        tx.object(params.predictId),
        tx.object(params.managerId),
        tx.object(params.oracleId),
        tx.pure.string(params.shape),
        legs,
        tx.pure.u64(params.maxLossBudget),
        tx.object('0x6'),
      ],
    });
  }

  async readNav(vaultId: string, quoteType: string, predictId: string, oracleId: string, sender: string): Promise<number> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::vault::nav`,
      typeArguments: [quoteType],
      arguments: [tx.object(vaultId), tx.object(predictId), tx.object(oracleId), tx.object('0x6')],
    });
    const result = await this.client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const navBytes = result.results?.at(-1)?.returnValues?.[0]?.[0];
    if (!navBytes) throw new Error('readNav: missing devInspect return value');
    return decodeU64LE(navBytes);
  }

  async readShareValueMarked(
    vaultId: string,
    quoteType: string,
    shares: number,
    predictId: string,
    oracleId: string,
    sender: string,
  ): Promise<number> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::vault::share_value_marked`,
      typeArguments: [quoteType],
      arguments: [tx.object(vaultId), tx.pure.u64(shares), tx.object(predictId), tx.object(oracleId), tx.object('0x6')],
    });
    const result = await this.client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const valueBytes = result.results?.at(-1)?.returnValues?.[0]?.[0];
    if (!valueBytes) throw new Error('readShareValueMarked: missing devInspect return value');
    return decodeU64LE(valueBytes);
  }

  async readShareValue(vaultId: string, quoteType: string, shares: number, sender: string): Promise<number> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::vault::share_value`,
      typeArguments: [quoteType],
      arguments: [tx.object(vaultId), tx.pure.u64(shares)],
    });
    const result = await this.client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const valueBytes = result.results?.at(-1)?.returnValues?.[0]?.[0];
    if (!valueBytes) throw new Error('readShareValue: missing devInspect return value');
    return decodeU64LE(valueBytes);
  }
}
