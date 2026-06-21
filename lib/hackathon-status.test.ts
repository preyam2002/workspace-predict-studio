import { describe, expect, it } from 'vitest';
import {
  classifyConfigGates,
  classifyGateOutput,
  formatHackathonStatus,
  parseEnvContent,
  summarizeGateStatuses,
  type HackathonGate,
} from './hackathon-status';

describe('hackathon readiness status helpers', () => {
  it('classifies known shell gate outputs', () => {
    expect(classifyGateOutput('verify:first', 'devinspect_quote\tok\task=1\tbid=1')).toEqual({
      name: 'verify:first',
      status: 'pass',
      detail: 'live Predict oracle/devInspect gate passed',
    });
    expect(classifyGateOutput('deepbook:spot-check', 'deepbook_spot_status\tblocked_missing_deep')).toEqual({
      name: 'deepbook:spot-check',
      status: 'blocked',
      detail: 'needs 500 funded DEEP for DeepBook Spot pool creation',
    });
    expect(
      classifyGateOutput('deepbook:spot-check', 'deepbook_spot_status\tready_to_dry_run\ndeepbook_spot_dry_run\tpass'),
    ).toEqual({
      name: 'deepbook:spot-check',
      status: 'pass',
      detail: 'DeepBook Spot pool creation dry-run passed',
    });
    expect(
      classifyGateOutput(
        'address:inventory',
        [
          'active\tcool-dichroite\t0x89',
          'address_summary\talias\taddress\tcoin_types\tsui\tpredict_dusdc\tstudio_lp\tdeep\tdbusdc',
          'address_summary\tcool-dichroite\t0x89\t49\t0.250509634\t0\t1999.999999\t0\t0',
        ].join('\n'),
      ),
    ).toEqual({
      name: 'address:inventory',
      status: 'pass',
      detail: 'active wallet has SUI and STUDIO_LP for live demo controls',
    });
    expect(classifyGateOutput('settle:sample', 'oracle_not_settled\t0xoracle\texpiry=1780478100000')).toEqual({
      name: 'settle:sample',
      status: 'blocked',
      detail: 'sample oracle has not settled yet',
    });
    expect(classifyGateOutput('settle:vault', 'vault_settle_execute\t0xdigest')).toEqual({
      name: 'settle:vault',
      status: 'pass',
      detail: 'vault settlement digest recorded or executable',
    });
    expect(classifyGateOutput('collateral:demo', 'mint+lock+borrow\t0x1\nk2_onchain_verified=success')).toEqual({
      name: 'collateral:demo',
      status: 'pass',
      detail: 'K2 note-backed lending loop re-verified on-chain (status=success)',
    });
    expect(classifyGateOutput('collateral:demo', 'k2_onchain_verified=failed')).toEqual({
      name: 'collateral:demo',
      status: 'fail',
      detail: 'recorded K2 digests did not resolve to success on-chain',
    });
    expect(classifyGateOutput('rfq:demo', 'fill digest 0xabc\nrfq_onchain_verified=success')).toEqual({
      name: 'rfq:demo',
      status: 'pass',
      detail: 'RFQ signed-quote fill re-verified on-chain (status=success)',
    });
    expect(classifyGateOutput('kiosk:demo', 'RoyaltyPaid amount=25000\nkiosk_onchain_verified=success')).toEqual({
      name: 'kiosk:demo',
      status: 'pass',
      detail: 'Kiosk royalty resale re-verified on-chain (status=success)',
    });
  });

  it('summarizes and formats blocked readiness without calling it complete', () => {
    const gates: HackathonGate[] = [
      { name: 'verify:first', status: 'pass', detail: 'ok' },
      { name: 'deepbook:spot-check', status: 'blocked', detail: 'needs DEEP' },
      { name: 'settle:sample', status: 'blocked', detail: 'needs oracle settlement' },
    ];

    expect(summarizeGateStatuses(gates)).toEqual({ pass: 1, blocked: 2, fail: 0, ready: false });
    expect(formatHackathonStatus(gates)).toContain('hackathon_ready\tfalse');
    expect(formatHackathonStatus(gates)).toContain('gate\tblocked\tdeepbook:spot-check\tneeds DEEP');
  });

  it('classifies Enoki and secondary-market config gates from env', () => {
    expect(classifyConfigGates({})).toEqual([
      {
        name: 'enoki:config',
        status: 'blocked',
        detail: 'missing NEXT_PUBLIC_ENOKI_API_KEY, NEXT_PUBLIC_GOOGLE_CLIENT_ID, ENOKI_PRIVATE_KEY',
      },
      {
        name: 'secondary-market:config',
        status: 'blocked',
        detail: 'missing NEXT_PUBLIC_CETUS_STUDIO_POOL_ID or funded DeepBook Spot pool',
      },
      {
        name: 'ai-intent:config',
        status: 'blocked',
        detail: 'missing ANTHROPIC_API_KEY',
      },
      {
        name: 'demo:video',
        status: 'blocked',
        detail: 'missing DEMO_VIDEO_URL',
      },
      {
        name: 'deepsurge:submission',
        status: 'blocked',
        detail: 'missing DEEPSURGE_SUBMISSION_URL',
      },
    ]);

    expect(
      classifyConfigGates({
        NEXT_PUBLIC_ENOKI_API_KEY: 'public',
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'google',
        ENOKI_PRIVATE_KEY: 'private',
        ANTHROPIC_API_KEY: 'anthropic',
        NEXT_PUBLIC_CETUS_STUDIO_POOL_ID: '0xpool',
        DEMO_VIDEO_URL: 'https://example.com/demo',
        DEEPSURGE_SUBMISSION_URL: 'https://deepsurge.example/submission',
      }),
    ).toEqual([
      { name: 'enoki:config', status: 'pass', detail: 'Enoki client and sponsor credentials are configured' },
      { name: 'secondary-market:config', status: 'pass', detail: 'STUDIO_LP/dUSDC secondary-market pool is configured' },
      { name: 'ai-intent:config', status: 'pass', detail: 'Anthropic intent API key is configured' },
      { name: 'demo:video', status: 'pass', detail: 'demo video URL is recorded' },
      { name: 'deepsurge:submission', status: 'pass', detail: 'DeepSurge submission URL is recorded' },
    ]);
  });

  it('accepts a ready DeepBook Spot path as secondary-market config', () => {
    expect(
      classifyConfigGates(
        {},
        [{ name: 'deepbook:spot-check', status: 'pass', detail: 'wallet has enough DEEP for DeepBook Spot dry-run' }],
      ).find((gate) => gate.name === 'secondary-market:config'),
    ).toEqual({
      name: 'secondary-market:config',
      status: 'pass',
      detail: 'DeepBook Spot secondary-market path is funded and registry-ready',
    });
  });

  it('parses local env files without treating comments or blank values as configured', () => {
    expect(
      parseEnvContent(`
# comment
NEXT_PUBLIC_CETUS_STUDIO_POOL_ID=0xpool
ENOKI_PRIVATE_KEY=
DEMO_VIDEO_URL="https://example.com/demo"
`),
    ).toEqual({
      NEXT_PUBLIC_CETUS_STUDIO_POOL_ID: '0xpool',
      ENOKI_PRIVATE_KEY: '',
      DEMO_VIDEO_URL: 'https://example.com/demo',
    });
  });
});
