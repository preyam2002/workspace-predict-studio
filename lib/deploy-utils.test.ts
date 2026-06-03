import { describe, expect, it } from 'vitest';
import { parsePublishResult, parseVaultSetupResult } from './deploy-utils';

describe('parsePublishResult', () => {
  it('extracts the package id and publish-time STUDIO_LP share factory', () => {
    expect(
      parsePublishResult({
        objectChanges: [
          { type: 'created', objectType: '0x4::studio_lp::ShareFactory', objectId: '0xfactory' },
          { type: 'published', packageId: '0xpackage' },
        ],
      }),
    ).toEqual({ packageId: '0xpackage', shareFactoryId: '0xfactory' });
  });

  it('extracts shared vault and manager escrow ids from setup object changes', () => {
    expect(
      parseVaultSetupResult({
        objectChanges: [
          { type: 'created', objectType: '0x4::vault::ManagerEscrow', objectId: '0xescrow' },
          { type: 'created', objectType: '0x4::vault::KeeperCap', objectId: '0xkeeper' },
          { type: 'created', objectType: '0x4::vault::StructuredVault<0xd::dusdc::DUSDC>', objectId: '0xvault' },
        ],
      }),
    ).toEqual({ vaultId: '0xvault', managerEscrowId: '0xescrow', keeperCapId: '0xkeeper' });
  });
});
