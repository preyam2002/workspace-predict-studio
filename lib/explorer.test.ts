import { describe, expect, it } from 'vitest';
import { suiExplorerObjectUrl, suiExplorerTxUrl } from './explorer';

describe('Sui explorer links', () => {
  it('formats testnet transaction and object links', () => {
    expect(suiExplorerTxUrl('abc', 'testnet')).toBe('https://suiscan.xyz/testnet/tx/abc');
    expect(suiExplorerObjectUrl('0x123', 'testnet')).toBe('https://suiscan.xyz/testnet/object/0x123');
  });
});
