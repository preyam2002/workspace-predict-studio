import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getAppNetworkConfig, isConfiguredId } from './network-config';

describe('network config shim', () => {
  it('defaults to testnet ids and reports margin composition unavailable without a concrete package path', () => {
    const config = getAppNetworkConfig({});

    expect(config.network).toBe('testnet');
    expect(config.predictStudioPackage).toBe('0x0');
    expect(config.margin.supported).toBe(false);
    expect(config.margin.reason).toMatch(/no verified/i);
  });

  it('flips every configured object id from the selected network namespace', () => {
    const config = getAppNetworkConfig({
      NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
      NEXT_PUBLIC_MAINNET_PREDICT_STUDIO_PACKAGE: '0xmainstudio',
      NEXT_PUBLIC_MAINNET_DEEPBOOK_PREDICT_PACKAGE: '0xmaindbp',
      NEXT_PUBLIC_MAINNET_MANAGER_ID: '0xmainmanager',
      NEXT_PUBLIC_MAINNET_DUSDC_TYPE: '0xmain::dusdc::DUSDC',
      NEXT_PUBLIC_TESTNET_PREDICT_STUDIO_PACKAGE: '0xteststudio',
      NEXT_PUBLIC_TESTNET_MANAGER_ID: '0xtestmanager',
      NEXT_PUBLIC_MARGIN_PACKAGE: '0xmargin',
      NEXT_PUBLIC_MARGIN_COMPOSE_TARGET: '0xmargin::compose::leverage_note',
    });

    expect(config.network).toBe('mainnet');
    expect(config.predictStudioPackage).toBe('0xmainstudio');
    expect(config.deepbookPredictPackage).toBe('0xmaindbp');
    expect(config.managerId).toBe('0xmainmanager');
    expect(config.dusdcType).toBe('0xmain::dusdc::DUSDC');
    expect(config.margin).toEqual({
      supported: true,
      packageId: '0xmargin',
      composeTarget: '0xmargin::compose::leverage_note',
    });
  });

  it('reads collateral and kiosk env gates used by the live UI', () => {
    const config = getAppNetworkConfig({
      NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE: '0xstudio',
      NEXT_PUBLIC_COLLATERAL_MARKET_ID: '0xmarket',
      NEXT_PUBLIC_COLLATERAL_PACKAGE: '0xk2',
      NEXT_PUBLIC_KIOSK_PACKAGE: '0xkiosk',
      NEXT_PUBLIC_KIOSK_POLICY_ID: '0xpolicy',
    });

    expect(config.collateralMarketId).toBe('0xmarket');
    expect(config.collateralPackageId).toBe('0xk2');
    expect(config.kioskPackage).toBe('0xkiosk');
    expect(config.kioskPolicyId).toBe('0xpolicy');
  });

  it('uses direct NEXT_PUBLIC env reads so Next can inline client config', () => {
    const source = readFileSync('lib/network-config.ts', 'utf8');

    expect(source).toContain('process.env.NEXT_PUBLIC_COLLATERAL_PACKAGE');
    expect(source).toContain('process.env.NEXT_PUBLIC_KIOSK_PACKAGE');
    expect(source).toContain('process.env.NEXT_PUBLIC_KIOSK_POLICY_ID');
  });

  it('treats zero package ids as unconfigured', () => {
    expect(isConfiguredId(undefined)).toBe(false);
    expect(isConfiguredId('')).toBe(false);
    expect(isConfiguredId('0x0')).toBe(false);
    expect(isConfiguredId('0x0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
    expect(isConfiguredId('0xad53')).toBe(true);
  });
});
