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
