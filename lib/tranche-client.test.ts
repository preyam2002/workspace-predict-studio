import { describe, expect, it } from 'vitest';
import { TrancheClient } from './tranche-client';

describe('TrancheClient', () => {
  it('builds split, merge, and redeem transactions without network IO', () => {
    const client = new TrancheClient('0xstudio');
    const ids = { trancheVaultId: '0xtranche', recipient: '0xabc' };

    expect(() => client.buildSplitTx(ids, '0xshare')).not.toThrow();
    expect(() => client.buildMergeTx(ids, '0xpt', '0xyt')).not.toThrow();
    expect(() => client.buildRedeemPtTx(ids, '0xpt')).not.toThrow();
    expect(() => client.buildRedeemYtTx(ids, '0xyt')).not.toThrow();
  });
});
