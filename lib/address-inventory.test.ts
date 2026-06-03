import { describe, expect, it } from 'vitest';
import { formatAddressInventory, summarizeImportantBalances } from './address-inventory';

describe('address inventory formatting', () => {
  it('summarizes important testnet assets across local addresses', () => {
    const summary = summarizeImportantBalances({
      alias: 'cool-dichroite',
      address: '0x89',
      balances: [
        { coinType: '0x2::sui::SUI', totalBalance: '250509634', coinObjectCount: 1 },
        {
          coinType: '0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f::studio_lp::STUDIO_LP',
          totalBalance: '1999999999000',
          coinObjectCount: 1,
        },
        {
          coinType: '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP',
          totalBalance: '0',
          coinObjectCount: 3,
        },
      ],
    });

    expect(summary.important.SUI.display).toBe('0.250509634');
    expect(summary.important.STUDIO_LP.display).toBe('1999.999999');
    expect(summary.important.DEEP.coinObjectCount).toBe(3);
    expect(summary.important.DEEP.readyForDeepbookPoolFee).toBe(false);

    expect(formatAddressInventory([summary])).toContain(
      'address_summary\tcool-dichroite\t0x89\t3\t0.250509634\t0\t1999.999999\t0\t0',
    );
  });
});
