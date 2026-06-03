import { describe, expect, it } from 'vitest';
import {
  DEEP_POOL_CREATION_FEE,
  DEFAULT_DEEPBOOK_TESTNET_PACKAGE_ID,
  DEFAULT_DEEPBOOK_TESTNET_REGISTRY_ID,
  bestDeepAddress,
  deepbookPackageFromRegistryType,
  deepbookSpotPoolConfigFromEnv,
  deepbookSpotReadiness,
  isDeepCoinType,
  studioLpCoinType,
  summarizeDeepBalance,
  type AddressDeepBalanceSummary,
} from './deepbook-spot-check';

describe('DeepBook Spot readiness helpers', () => {
  it('recognizes DEEP coin types and ignores similarly named packages', () => {
    expect(isDeepCoinType('0xabc::deep::DEEP')).toBe(true);
    expect(isDeepCoinType('0xabc::deepbook::DEEP')).toBe(false);
    expect(isDeepCoinType('0xabc::deep::deep')).toBe(false);
  });

  it('requires the 500 DEEP pool creation fee', () => {
    const almost = summarizeDeepBalance([
      { coinType: '0xabc::deep::DEEP', totalBalance: String(DEEP_POOL_CREATION_FEE - 1n), coinObjectCount: 1 },
    ]);
    const ready = summarizeDeepBalance([
      { coinType: '0xabc::deep::DEEP', totalBalance: String(DEEP_POOL_CREATION_FEE), coinObjectCount: 1 },
    ]);

    expect(almost.ready).toBe(false);
    expect(ready.ready).toBe(true);
    expect(ready.totalBalance).toBe(DEEP_POOL_CREATION_FEE);
  });

  it('reports the next blocker after DEEP is present', () => {
    expect(deepbookSpotReadiness({ ready: false, totalBalance: 0n, coinObjectCount: 0, coinTypes: [] }, undefined)).toBe(
      'blocked_missing_deep',
    );
    expect(
      deepbookSpotReadiness(
        { ready: true, totalBalance: DEEP_POOL_CREATION_FEE, coinObjectCount: 1, coinTypes: ['0xabc::deep::DEEP'] },
        undefined,
      ),
    ).toBe('ready_needs_registry');
    expect(
      deepbookSpotReadiness(
        { ready: true, totalBalance: DEEP_POOL_CREATION_FEE, coinObjectCount: 1, coinTypes: ['0xabc::deep::DEEP'] },
        '0xregistry',
      ),
    ).toBe('ready_to_dry_run');
  });

  it('selects the local address with the largest funded DEEP balance', () => {
    const addresses: AddressDeepBalanceSummary[] = [
      {
        address: '0xempty',
        summary: { ready: false, totalBalance: 0n, coinObjectCount: 0, coinTypes: [] },
      },
      {
        address: '0xfunded',
        summary: {
          ready: true,
          totalBalance: DEEP_POOL_CREATION_FEE,
          coinObjectCount: 1,
          coinTypes: ['0xabc::deep::DEEP'],
        },
      },
    ];

    expect(bestDeepAddress(addresses)?.address).toBe('0xfunded');
    expect(bestDeepAddress(addresses.toReversed())?.address).toBe('0xfunded');
  });

  it('derives DeepBook Spot dry-run config from env', () => {
    expect(studioLpCoinType('0xstudio')).toBe('0xstudio::studio_lp::STUDIO_LP');
    expect(deepbookPackageFromRegistryType('0xabc123::registry::Registry')).toBe('0xabc123');
    expect(deepbookPackageFromRegistryType('0xabc123::pool::Pool')).toBeUndefined();

    expect(
      deepbookSpotPoolConfigFromEnv({
        NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE: '0xstudio',
        NEXT_PUBLIC_DUSDC_TYPE: '0xdusdc::dusdc::DUSDC',
        DEEPBOOK_REGISTRY_ID: '0xregistry',
        DEEPBOOK_SPOT_PACKAGE_ID: '0xdeepbook',
      }),
    ).toEqual({
      registryId: '0xregistry',
      deepbookPackageId: '0xdeepbook',
      baseCoinType: '0xstudio::studio_lp::STUDIO_LP',
      quoteCoinType: '0xdusdc::dusdc::DUSDC',
      tickSize: 1,
      lotSize: 1000,
      minSize: 1000,
    });
  });

  it('defaults DeepBook Spot dry-run config to official testnet SDK IDs', () => {
    expect(
      deepbookSpotPoolConfigFromEnv({
        NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE: '0xstudio',
        NEXT_PUBLIC_DUSDC_TYPE: '0xdusdc::dusdc::DUSDC',
      }),
    ).toMatchObject({
      registryId: DEFAULT_DEEPBOOK_TESTNET_REGISTRY_ID,
      deepbookPackageId: DEFAULT_DEEPBOOK_TESTNET_PACKAGE_ID,
    });

    expect(
      deepbookSpotPoolConfigFromEnv({
        NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
        NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE: '0xstudio',
        NEXT_PUBLIC_DUSDC_TYPE: '0xdusdc::dusdc::DUSDC',
      }),
    ).toMatchObject({
      registryId: undefined,
      deepbookPackageId: undefined,
    });
  });
});
