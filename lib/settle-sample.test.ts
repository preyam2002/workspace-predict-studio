import { describe, expect, it } from 'vitest';
import {
  buildSettleSamplePtbArgs,
  buildSettleVaultPtbArgs,
  oracleSettlementStatus,
  parseSuiJsonOutput,
  positionSettled,
  vaultStrategyStatus,
} from './settle-sample';

const input = {
  packageId: '0xstudio',
  predictId: '0xpredict',
  managerId: '0xmanager',
  oracleId: '0xoracle',
  positionId: '0xposition',
  dusdcType: '0xdusdc::dusdc::DUSDC',
};

const vaultInput = {
  packageId: '0xstudio',
  predictId: '0xpredict',
  managerId: '0xmanager',
  oracleId: '0xoracle',
  vaultId: '0xvault',
  keeperCapId: '0xkeeper',
  managerEscrowId: '0xescrow',
  quoteType: '0xdusdc::dusdc::DUSDC',
};

describe('settle sample helpers', () => {
  it('builds a dry-run PTB by default and executes only when requested', () => {
    const dryRun = buildSettleSamplePtbArgs(input);
    const execute = buildSettleSamplePtbArgs(input, { execute: true });

    expect(dryRun).toContain('--dry-run');
    expect(execute).not.toContain('--dry-run');
    expect(dryRun).toEqual([
      'client',
      'ptb',
      '--move-call',
      '0xstudio::studio::settle_to_receipt',
      '<0xdusdc::dusdc::DUSDC>',
      '@0xpredict',
      '@0xmanager',
      '@0xoracle',
      '@0xposition',
      '@0x6',
      '--gas-budget',
      '50000000',
      '--json',
      '--dry-run',
    ]);
  });

  it('reads settlement state from Sui object JSON', () => {
    expect(oracleSettlementStatus({ content: { settlement_price: null, expiry: '1780478100000' } })).toEqual({
      settled: false,
      expiryMs: 1780478100000,
    });
    expect(oracleSettlementStatus({ content: { settlement_price: '67100000000000', expiry: '1780478100000' } })).toEqual({
      settled: true,
      expiryMs: 1780478100000,
      settlementPrice: '67100000000000',
    });
    expect(positionSettled({ content: { settled: true } })).toBe(true);
  });

  it('parses Sui CLI JSON output even when dry-run text is prefixed', () => {
    expect(parseSuiJsonOutput('Dry run completed, execution status: success\n{"digest":"0xdigest"}')).toEqual({
      digest: '0xdigest',
    });
    expect(parseSuiJsonOutput('{"digest":"0xdigest"}')).toEqual({ digest: '0xdigest' });
    expect(parseSuiJsonOutput('Dry run completed, execution status: success')).toEqual({
      effects: { status: { status: 'success' } },
    });
  });

  it('builds vault keeper-settle PTB args and reads open strategy state', () => {
    expect(buildSettleVaultPtbArgs(vaultInput)).toEqual([
      'client',
      'ptb',
      '--move-call',
      '0xstudio::vault::keeper_settle',
      '<0xdusdc::dusdc::DUSDC>',
      '@0xvault',
      '@0xkeeper',
      '@0xescrow',
      '@0xpredict',
      '@0xmanager',
      '@0xoracle',
      '@0x6',
      '--gas-budget',
      '50000000',
      '--json',
      '--dry-run',
    ]);
    expect(buildSettleVaultPtbArgs(vaultInput, { execute: true })).not.toContain('--dry-run');

    expect(
      vaultStrategyStatus({
        content: {
          strategy_open: true,
          open: {
            id: '0xposition',
            oracle_id: '0xoracle',
            settled: false,
          },
        },
      }),
    ).toEqual({ open: true, positionId: '0xposition', oracleId: '0xoracle', positionSettled: false });
    expect(vaultStrategyStatus({ content: { strategy_open: false } })).toEqual({ open: false });
  });
});
