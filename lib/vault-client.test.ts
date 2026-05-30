import { describe, expect, it } from 'vitest';
import { VaultClient, type VaultIds } from './vault-client';

const ids: VaultIds = {
  vaultId: '0x1',
  quoteType: '0xd::dusdc::DUSDC',
  recipient: '0xabc',
};

describe('VaultClient', () => {
  it('builds deposit, queued deposit, withdraw, claim, and keeper transactions without network IO', () => {
    const client = new VaultClient({} as never, '0x4');

    expect(() => client.buildDepositTx(ids, '0xcoin')).not.toThrow();
    expect(() => client.buildRequestDepositTx(ids, '0xcoin')).not.toThrow();
    expect(() => client.buildWithdrawTx(ids, '0xshare')).not.toThrow();
    expect(() => client.buildClaimTx(ids, '0xreceipt')).not.toThrow();
    expect(() => client.buildKeeperRollTx(ids.vaultId, ids.quoteType, '0xcap', 1_000_000)).not.toThrow();
    const escrowTx = client.buildCreateManagerEscrowTx(ids, '0x2');
    expect(escrowTx.getData().commands[0].MoveCall?.typeArguments).toEqual([ids.quoteType]);
  });

  it('builds a create-and-share vault transaction from a share factory', () => {
    const client = new VaultClient({} as never, '0x4');
    const tx = client.buildCreateAndShareVaultTx({
      factoryId: '0x3',
      quoteType: ids.quoteType,
      managerOwner: ids.recipient,
      minDeposit: 1_000_000,
      performanceFeeBps: 1_000,
      strategy: 'fixed_coupon_range',
    });

    const call = tx.getData().commands[0].MoveCall;
    expect(call?.module).toBe('vault');
    expect(call?.function).toBe('create_and_share_vault');
    expect(call?.typeArguments).toEqual([ids.quoteType]);
  });

  it('builds a create-and-share vault transaction with manager escrow binding', () => {
    const client = new VaultClient({} as never, '0x4');
    const tx = client.buildCreateVaultWithManagerEscrowTx({
      factoryId: '0x3',
      quoteType: ids.quoteType,
      managerId: '0x5',
      recipient: ids.recipient,
      minDeposit: 1_000_000,
      performanceFeeBps: 1_000,
      strategy: 'fixed_coupon_range',
    });

    const data = tx.getData();
    expect(data.commands[0].MoveCall?.function).toBe('create_and_share_vault_with_manager_escrow');
    expect(data.commands[0].MoveCall?.typeArguments).toEqual([ids.quoteType]);
    expect(data.commands[1].TransferObjects).toBeDefined();
  });

  it('builds an escrow-backed strategy roll transaction', () => {
    const client = new VaultClient({} as never, '0x4');
    const tx = client.buildRollIntoStrategyTx({
      vaultId: ids.vaultId,
      managerEscrowId: '0x5',
      quoteType: ids.quoteType,
      predictId: '0x6',
      managerId: '0x7',
      oracleId: '0x8',
      shape: 'digital_call',
      legs: [{ isRange: false, isUp: true, lowerStrike: 70_000, higherStrike: 0, quantity: 1_000_000 }],
      maxLossBudget: 500_000,
    });

    const rollCall = tx.getData().commands.at(-1)?.MoveCall;
    expect(rollCall?.module).toBe('vault');
    expect(rollCall?.function).toBe('roll_into_strategy');
    expect(rollCall?.typeArguments).toEqual([ids.quoteType]);
  });

  it('reads NAV from a devInspect u64 return value', async () => {
    const client = new VaultClient(
      {
        devInspectTransactionBlock: async () => ({
          results: [{ returnValues: [[[0x40, 0x42, 0x0f, 0, 0, 0, 0, 0], 'u64']] }],
        }),
      } as never,
      '0x4',
    );

    await expect(client.readNav(ids.vaultId, ids.quoteType, ids.recipient)).resolves.toBe(1_000_000);
  });
});
