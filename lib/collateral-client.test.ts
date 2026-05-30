import { describe, expect, it } from 'vitest';
import { CollateralClient } from './collateral-client';

describe('CollateralClient', () => {
  it('builds collateral-market PTBs without network IO', () => {
    const client = new CollateralClient('0xstudio');
    const ids = { marketId: '0xmarket', recipient: '0xabc' };

    expect(() => client.buildDepositLiquidityTx(ids, '0xdusdc')).not.toThrow();
    expect(() => client.buildOpenPositionTx(ids, '0xshare', 800_000)).not.toThrow();
    expect(() => client.buildBorrowTx(ids, '0xposition', 400_000)).not.toThrow();
    expect(() => client.buildRepayTx(ids.marketId, '0xposition', '0xdusdc')).not.toThrow();
    expect(() => client.buildCloseTx(ids, '0xposition')).not.toThrow();
  });
});
