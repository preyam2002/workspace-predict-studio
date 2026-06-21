import type { AppNetwork } from './network-config';

export function suiExplorerTxUrl(digest: string, network: AppNetwork = 'testnet') {
  return `https://suiscan.xyz/${network}/tx/${digest}`;
}

export function suiExplorerObjectUrl(objectId: string, network: AppNetwork = 'testnet') {
  return `https://suiscan.xyz/${network}/object/${objectId}`;
}
