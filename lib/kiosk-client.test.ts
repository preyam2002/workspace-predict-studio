import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { buildMintAndListNoteTx, buildPurchaseNoteTx, royaltyAmount } from './kiosk-client';
import { isConfiguredId } from './network-config';

describe('kiosk-client', () => {
  it('computes the floor royalty in the Move basis (paid * bps / 10_000)', () => {
    expect(royaltyAmount(100_000, 250)).toBe(2_500);
    expect(royaltyAmount(1_000_000, 1_000)).toBe(100_000);
    expect(royaltyAmount(999, 250)).toBe(24); // floor(24.975)
    expect(royaltyAmount(0, 250)).toBe(0);
  });

  it('builds a mint+lock+list PTB', () => {
    const tx = buildMintAndListNoteTx({
      pkg: '0xkiosk',
      policyId: '0xpolicy',
      structureHash: [1, 2, 3],
      publisher: '0x00000000000000000000000000000000000000000000000000000000000000aa',
      premium: 500_000,
      maturityMs: 1_800_000_000_000,
      royaltyBps: 250,
      price: 100_000,
      seller: '0x00000000000000000000000000000000000000000000000000000000000000bb',
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds a purchase+royalty PTB', () => {
    const tx = buildPurchaseNoteTx({
      pkg: '0xkiosk',
      policyId: '0xpolicy',
      kioskId: '0xkioskobj',
      noteId: '0x00000000000000000000000000000000000000000000000000000000000000cc',
      price: 100_000,
      royaltyBps: 250,
      buyer: '0x00000000000000000000000000000000000000000000000000000000000000dd',
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('treats the zero object id as missing kiosk config', () => {
    expect(isConfiguredId('0x0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
  });
});
