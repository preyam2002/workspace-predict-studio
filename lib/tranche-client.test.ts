import { describe, expect, it } from 'vitest';
import { TrancheClient } from './tranche-client';

describe('TrancheClient', () => {
  it('builds split, merge, and redeem transactions without network IO', () => {
    const client = new TrancheClient('0x4');
    const ids = { trancheVaultId: '0x1', recipient: '0xabc' };

    expect(() => client.buildSplitTx(ids, '0x2')).not.toThrow();
    expect(() => client.buildMergeTx(ids, '0x3', '0x4')).not.toThrow();
    expect(() => client.buildRedeemPtTx(ids, '0x3')).not.toThrow();
    expect(() => client.buildRedeemYtTx(ids, '0x4')).not.toThrow();
  });

  it('builds a production tranche settlement transaction', () => {
    const client = new TrancheClient('0x4');
    const tx = client.buildSettleTx({ trancheVaultId: '0x1', vaultId: '0x2', oracleId: '0x3' });

    const call = tx.getData().commands[0].MoveCall;
    expect(call?.module).toBe('pt_yt');
    expect(call?.function).toBe('settle_tranche');
  });
});
