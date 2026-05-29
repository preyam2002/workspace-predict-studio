import { MAX_LEGS_PER_PTB, type Decomposition, type Leg, type OracleState, type PricedDecomp } from './types';

export type QuoteLeg = (leg: Leg) => Promise<number>;

function legKey(leg: Leg): string {
  return [leg.isRange, leg.isUp, leg.lowerStrike, leg.higherStrike, leg.quantity].join(':');
}

function sameDecomposition(a: Decomposition, b: Decomposition): boolean {
  return a.legs.map(legKey).join('|') === b.legs.map(legKey).join('|');
}

function candidateDecompositions(base: Decomposition): Decomposition[] {
  const out: Decomposition[] = [base];
  const ranges = base.legs.filter((leg) => leg.isRange).sort((a, b) => a.lowerStrike - b.lowerStrike);
  const merged: Leg[] = [];

  for (const leg of ranges) {
    const prev = merged.at(-1);
    if (prev && prev.higherStrike === leg.lowerStrike && prev.quantity === leg.quantity) {
      prev.higherStrike = leg.higherStrike;
    } else {
      merged.push({ ...leg });
    }
  }

  const nonRanges = base.legs.filter((leg) => !leg.isRange);
  const coarse = { legs: [...merged, ...nonRanges], legCount: merged.length + nonRanges.length };
  if (coarse.legCount < base.legCount) out.push(coarse);

  return out.filter((candidate, index, all) => all.findIndex((other) => sameDecomposition(candidate, other)) === index);
}

export async function optimize(
  base: Decomposition,
  _oracle: OracleState,
  quote: QuoteLeg,
): Promise<{ best: PricedDecomp; all: PricedDecomp[]; savingsVsNaive: number }> {
  const candidates = candidateDecompositions(base).filter((candidate) => candidate.legCount <= MAX_LEGS_PER_PTB);
  if (candidates.length === 0) throw new Error(`No decomposition fits ${MAX_LEGS_PER_PTB} legs`);

  const priced: PricedDecomp[] = [];
  for (const candidate of candidates) {
    const costs = await Promise.all(candidate.legs.map(quote));
    priced.push({ ...candidate, totalCost: costs.reduce((sum, cost) => sum + cost, 0) });
  }

  const baseCost = priced.find((candidate) => sameDecomposition(candidate, base))?.totalCost ?? priced[0].totalCost;
  priced.sort((a, b) => a.totalCost - b.totalCost || a.legCount - b.legCount);

  return {
    best: priced[0],
    all: priced,
    savingsVsNaive: Math.max(0, baseCost - priced[0].totalCost),
  };
}
