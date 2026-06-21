import { describe, expect, it } from 'vitest';
import { CollateralClient, noteBorrowFromObject } from './collateral-client';

describe('CollateralClient', () => {
  it('builds collateral-market PTBs without network IO', () => {
    const client = new CollateralClient('0xstudio');
    const ids = { marketId: '0xmarket', recipient: '0xabc' };

    expect(() => client.buildDepositLiquidityTx(ids, '0xdusdc')).not.toThrow();
    expect(() => client.buildOpenPositionTx(ids, '0xvault', '0xshare', 800_000)).not.toThrow();
    expect(() => client.buildBorrowTx(ids, '0xposition', 400_000)).not.toThrow();
    expect(() => client.buildRepayTx(ids.marketId, '0xposition', '0xdusdc')).not.toThrow();
    expect(() => client.buildCloseTx(ids, '0xposition')).not.toThrow();
    expect(() => client.buildCloseNoteTx(ids, '0xdusdc::dusdc::DUSDC', '0xposition')).not.toThrow();
  });

  it('chains mint -> lock-note -> borrow in a single PTB without network IO', () => {
    const client = new CollateralClient('0xstudio');
    expect(() =>
      client.buildMintAndBorrowTx({
        marketId: '0xmarket',
        predictId: '0xpredict',
        managerId: '0xmanager',
        oracleId: '0xoracle',
        dusdcType: '0xdusdc::dusdc::DUSDC',
        shape: 'bull_call_spread',
        legs: [{ isRange: false, isUp: true, lowerStrike: 90_000, higherStrike: 0, quantity: 1_000_000 }],
        maxLossBudget: 500_000,
        borrowAmount: 100_000,
        recipient: '0xabc',
      }),
    ).not.toThrow();
  });

  it('chains repay_note -> close_note in a single PTB, merging payment coins when needed', () => {
    const client = new CollateralClient('0xstudio');
    const base = {
      marketId: '0xmarket',
      dusdcType: '0xdusdc::dusdc::DUSDC',
      positionId: '0xposition',
      recipient: '0xabc',
    };

    expect(() =>
      client.buildRepayAndReclaimTx({ ...base, paymentCoinIds: ['0xcoin1', '0xcoin2'], debtAmount: 250_000 }),
    ).not.toThrow();
    expect(() => client.buildRepayAndReclaimTx({ ...base, paymentCoinIds: [], debtAmount: 0 })).not.toThrow();
    expect(() => client.buildRepayAndReclaimTx({ ...base, paymentCoinIds: [], debtAmount: 250_000 })).toThrow(
      /payment coin/,
    );
  });

  it('parses NoteBorrow summaries from owned-object content', () => {
    const loan = noteBorrowFromObject({
      objectId: '0xloan',
      content: {
        dataType: 'moveObject',
        fields: { market_id: '0xmarket', owner: '0xabc', floor_value: '524201', debt: '262100' },
      },
    });
    expect(loan).toEqual({ objectId: '0xloan', marketId: '0xmarket', owner: '0xabc', floorValue: 524201, debt: 262100 });

    expect(noteBorrowFromObject({ objectId: '0xloan' })).toBeUndefined();
    expect(
      noteBorrowFromObject({
        objectId: '0xloan',
        content: { dataType: 'moveObject', fields: { floor_value: 'nope', debt: '1' } },
      }),
    ).toBeUndefined();
  });
});
