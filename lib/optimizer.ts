import { priceSolution, solveCertifiedSparse } from './solver';
import { defaultImpactParams, fairFromSvi, optimalOrder, priceBasketSequential, splitAcrossCandidates, type AmmState, type ImpactParams } from './impact';
import { MAX_LEGS_PER_PTB, type Decomposition, type Leg, type OracleState, type PricedDecomp, type SparseTarget, type SVI } from './types';

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

export function optimizeSparse(target: SparseTarget, svi: SVI, forward: number) {
  const candidates = [4, 6, 8].map((maxLegs) =>
    priceSolution(solveCertifiedSparse(target, { maxLegs, tol: 0.005 }).solution, svi, forward),
  );
  candidates.sort((a, b) => a.premiumEst - b.premiumEst || a.legCount - b.legCount);
  return { best: candidates[0], all: candidates };
}

export function optimizeBasket(
  legs: Leg[],
  svi: SVI,
  forward: number,
  state: AmmState,
  params: ImpactParams = defaultImpactParams,
) {
  const fairOf = fairFromSvi(svi, forward);
  const order = optimalOrder(legs, state, (leg) => fairOf(leg), params);
  const orderedLegs = order.order.map((index) => legs[index]);
  const priced = priceBasketSequential(orderedLegs, state, (leg) => fairOf(leg), params);
  const splitLegs = orderedLegs.flatMap((leg) => {
    if (!leg.isRange && leg.quantity > 5_000_000) {
      return splitAcrossCandidates(
        leg,
        [
          { leg: { ...leg, lowerStrike: leg.lowerStrike - Math.max(1, Math.round(leg.lowerStrike * 0.01)) }, fairPrice: Math.max(0, fairOf(leg) * 0.98) },
          { leg, fairPrice: fairOf(leg) },
          { leg: { ...leg, lowerStrike: leg.lowerStrike + Math.max(1, Math.round(leg.lowerStrike * 0.01)) }, fairPrice: Math.min(1, fairOf(leg) * 1.02) },
        ],
        state,
        params,
      ).legs;
    }
    return [leg];
  });
  const exposure = legs.reduce((sum, leg) => sum + fairOf(leg) * leg.quantity, state.mtm);

  return {
    order: order.order,
    legs: splitLegs,
    totalCost: priced.sequential,
    impactCost: priced.impactCost,
    exposureOk: exposure <= (params.maxExposurePct ?? 0.8) * state.balance,
  };
}
