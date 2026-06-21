'use client';

import { ExternalLink } from 'lucide-react';
import { suiExplorerObjectUrl, suiExplorerTxUrl } from '@/lib/explorer';
import { getAppNetworkConfig } from '@/lib/network-config';

const network = getAppNetworkConfig().network;

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function ExplorerLink({ value, kind = 'tx', label }: { value: string; kind?: 'tx' | 'object'; label?: string }) {
  const href = kind === 'object' ? suiExplorerObjectUrl(value, network) : suiExplorerTxUrl(value, network);
  return (
    <a className="inline-flex min-w-0 items-center gap-1 blue-text hover:opacity-80" href={href} target="_blank" rel="noreferrer">
      <span className="truncate">{label ?? shortId(value)}</span>
      <ExternalLink size={13} className="shrink-0" />
    </a>
  );
}
