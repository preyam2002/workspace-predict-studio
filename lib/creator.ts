export interface PublisherFill {
  publisher?: string | null;
  volume: number;
  realizedPayout?: number;
}

export interface PublisherRank {
  publisher: string;
  volume: number;
  realizedPayout: number;
  fills: number;
}

export interface CapacityCappedFee {
  eligibleVolume: number;
  fee: number;
  remainingCapacity: number;
}

export function builderFee(amount: number, feeBps: number, capBps = 10): number {
  if (feeBps < 0 || feeBps > capBps) throw new Error(`builder fee exceeds cap ${capBps}bps`);
  return Math.floor((amount * feeBps) / 10_000);
}

export function capacityCappedBuilderFee(
  amount: number,
  feeBps: number,
  usedVolume: number,
  capacityCap: number,
  capBps = 10,
): CapacityCappedFee {
  const remainingCapacity = Math.max(0, capacityCap - usedVolume);
  const eligibleVolume = Math.min(amount, remainingCapacity);
  return {
    eligibleVolume,
    fee: builderFee(eligibleVolume, feeBps, capBps),
    remainingCapacity: Math.max(0, remainingCapacity - eligibleVolume),
  };
}

export function rankPublishers(fills: PublisherFill[]): PublisherRank[] {
  const byPublisher = new Map<string, PublisherRank>();
  for (const fill of fills) {
    if (!fill.publisher) continue;
    const current = byPublisher.get(fill.publisher) ?? {
      publisher: fill.publisher,
      volume: 0,
      realizedPayout: 0,
      fills: 0,
    };
    current.volume += fill.volume;
    current.realizedPayout += fill.realizedPayout ?? 0;
    current.fills += 1;
    byPublisher.set(fill.publisher, current);
  }
  return [...byPublisher.values()].sort((a, b) => b.volume - a.volume || b.realizedPayout - a.realizedPayout);
}
