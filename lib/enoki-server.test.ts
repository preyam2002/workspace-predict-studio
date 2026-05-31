import { describe, expect, it } from 'vitest';
import { createSponsoredMintTransaction, executeSponsoredMintTransaction } from './enoki-server';

describe('enoki server helpers', () => {
  it('creates a sponsored mint transaction with scoped targets and addresses', async () => {
    const result = await createSponsoredMintTransaction(
      { transactionKindBytes: 'AA==', sender: '0xabc' },
      {
        ENOKI_PRIVATE_KEY: 'secret',
        NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE: '0xstudio',
        NEXT_PUBLIC_SUI_NETWORK: 'testnet',
      },
      {
        createSponsoredTransaction: async (input) => {
          expect(input).toEqual({
            network: 'testnet',
            transactionKindBytes: 'AA==',
            sender: '0xabc',
            allowedMoveCallTargets: ['0xstudio::studio::build_and_mint_to_sender'],
            allowedAddresses: ['0xabc'],
          });
          return { digest: '0xdigest', bytes: 'sponsored-bytes' };
        },
      },
    );

    expect(result).toEqual({ digest: '0xdigest', bytes: 'sponsored-bytes' });
  });

  it('executes a sponsored transaction by digest and signature', async () => {
    const result = await executeSponsoredMintTransaction(
      { digest: '0xdigest', signature: 'sig' },
      { ENOKI_PRIVATE_KEY: 'secret' },
      {
        executeSponsoredTransaction: async (input) => {
          expect(input).toEqual({ digest: '0xdigest', signature: 'sig' });
          return { digest: '0xexecuted' };
        },
      },
    );

    expect(result).toEqual({ digest: '0xexecuted' });
  });
});
