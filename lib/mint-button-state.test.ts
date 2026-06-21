import { describe, expect, it } from 'vitest';
import { mintedPositionIdFromTransaction, mintDisabledReason } from './mint-state';

describe('MintButton state', () => {
  it('blocks minting when the selected oracle is settled or expired', () => {
    const base = {
      explicitDisabled: false,
      pending: false,
      legsReady: true,
      managerId: '0xmanager',
      dusdcType: '0xd::dusdc::DUSDC',
      accountConnected: true,
    };

    expect(mintDisabledReason({ ...base, oracleLive: false })).toBe('Oracle expired');
    expect(mintDisabledReason({ ...base, oracleLive: true })).toBeUndefined();
  });

  it('blocks minting quotes whose live ask is at or above max payout', () => {
    const base = {
      explicitDisabled: false,
      pending: false,
      legsReady: true,
      managerId: '0xmanager',
      dusdcType: '0xd::dusdc::DUSDC',
      accountConnected: true,
      oracleLive: true,
    };

    expect(mintDisabledReason({ ...base, netMaxGain: 0 })).toBe('Quote exceeds payout');
    expect(mintDisabledReason({ ...base, netMaxGain: -1 })).toBe('Quote exceeds payout');
    expect(mintDisabledReason({ ...base, netMaxGain: 1 })).toBeUndefined();
  });

  it('blocks minting when the connected wallet does not own the configured manager', () => {
    const base = {
      explicitDisabled: false,
      pending: false,
      legsReady: true,
      managerId: '0xmanager',
      dusdcType: '0xd::dusdc::DUSDC',
      accountConnected: true,
      accountAddress: '0xuser',
      managerOwner: '0xmanagerowner',
      oracleLive: true,
      netMaxGain: 1,
    };

    expect(mintDisabledReason(base)).toBe('Manager wallet required');
    expect(mintDisabledReason({ ...base, accountAddress: '0xmanagerowner' })).toBeUndefined();
  });

  it('extracts the minted StructuredPosition id from the StructureMinted event', () => {
    expect(
      mintedPositionIdFromTransaction({
        events: [
          {
            type: '0xstudio::studio::StructureMinted',
            parsedJson: {
              position_id: '0xposition',
            },
          },
        ],
      }),
    ).toBe('0xposition');
  });

  it('falls back to created StructuredPosition object changes when events are unavailable', () => {
    expect(
      mintedPositionIdFromTransaction({
        objectChanges: [
          {
            type: 'created',
            objectId: '0xposition',
            objectType: '0xstudio::studio::StructuredPosition',
          },
        ],
      }),
    ).toBe('0xposition');
  });
});
