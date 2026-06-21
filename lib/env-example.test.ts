import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const requiredKeys = [
  'SUI_RPC',
  'SUI_RPC_URL',
  'SUI_CLIENT_CONFIG',
  'NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE',
  'NEXT_PUBLIC_DEEPBOOK_PREDICT_PACKAGE',
  'NEXT_PUBLIC_MANAGER_ID',
  'NEXT_PUBLIC_DUSDC_TYPE',
  'NEXT_PUBLIC_VAULT_ID',
  'NEXT_PUBLIC_ORACLE_ID',
  'NEXT_PUBLIC_ENOKI_API_KEY',
  'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  'ENOKI_PRIVATE_KEY',
  'NEXT_PUBLIC_CETUS_STUDIO_POOL_ID',
  'DEEPBOOK_REGISTRY_ID',
  'DEEPBOOK_SPOT_PACKAGE_ID',
  'NEXT_PUBLIC_STUDIO_LP_TYPE',
  'DEEPBOOK_SPOT_TICK_SIZE',
  'DEEPBOOK_SPOT_LOT_SIZE',
  'DEEPBOOK_SPOT_MIN_SIZE',
  'ANTHROPIC_API_KEY',
];

describe('.env.example', () => {
  it('documents the live hackathon readiness variables', () => {
    const example = readFileSync('.env.example', 'utf8');

    for (const key of requiredKeys) expect(example).toContain(`${key}=`);
    expect(example).toContain('pnpm hackathon:status');
    expect(example).toContain('pnpm deepbook:spot-check -- --all-addresses --dry-run');
    expect(example).toContain('pnpm collateral:demo');
    expect(example).toContain('pnpm live:proof');
    expect(example).toContain('pnpm settle:sample -- --execute');
    expect(example).toContain('pnpm settle:vault -- --execute');
    expect(example).toContain(
      'NEXT_PUBLIC_COLLATERAL_MARKET_ID=0x22f9ed4a57aaa281c967b3383b5377ca9ce13d5bab90e08e5260563425f5a556',
    );
  });
});
