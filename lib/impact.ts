import { legProb } from './payoff';
import type { Leg, SVI } from './types';

export interface ImpactParams {
  baseSpread: number;
  minSpread: number;
  utilMult: number;
  minAsk: number;
  maxAsk: number;
  maxExposurePct?: number;
}

export interface AmmState {
  mtm: number;
  balance: number;
}

export interface BasketPricing {
  naive: number;
  sequential: number;
  impactCost: number;
}

export interface OrderedBasket {
  order: number[];
  totalCost: number;
}

export interface SplitCandidate {
  leg: Leg;
  fairPrice: number;
}

const DEFAULT_SPLIT_ITERS = 160;

export const defaultImpactParams: ImpactParams = {
  baseSpread: 0.02,
  minSpread: 0.005,
  utilMult: 1.5,
  minAsk: 0.01,
  maxAsk: 0.99,
  maxExposurePct: 0.8,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function askPrice(fairPrice: number, mtm: number, balance: number, params: ImpactParams): number {
  const fair = clamp(fairPrice, 0, 1);
  const bernoulliSpread = params.baseSpread * Math.sqrt(Math.max(0, fair * (1 - fair)));
  const utilization = balance > 0 ? (mtm / balance) ** 2 : Number.POSITIVE_INFINITY;
  const utilizationSpread = params.baseSpread * params.utilMult * utilization;
  return clamp(fair + Math.max(bernoulliSpread, params.minSpread) + utilizationSpread, params.minAsk, params.maxAsk);
}

export function legCost(fairPrice: number, mtm: number, balance: number, qty: number, params: ImpactParams): number {
  return askPrice(fairPrice, mtm, balance, params) * qty;
}

export function applyMint(state: AmmState, leg: Pick<Leg, 'quantity'>, fairPrice: number): AmmState {
  return { ...state, mtm: state.mtm + fairPrice * leg.quantity };
}

function exposureFor(legs: Leg[], fairOf: (leg: Leg, index: number) => number): number[] {
  return legs.map((leg, index) => fairOf(leg, index) * leg.quantity);
}

export function priceInOrder(
  legs: Leg[],
  order: number[],
  state: AmmState,
  fairOf: (leg: Leg, index: number) => number,
  params: ImpactParams,
): number {
  let running = { ...state };
  let cost = 0;
  for (const index of order) {
    const leg = legs[index];
    const fair = fairOf(leg, index);
    cost += legCost(fair, running.mtm, running.balance, leg.quantity, params);
    running = applyMint(running, leg, fair);
  }
  return cost;
}

export function priceBasketNaive(
  legs: Leg[],
  state: AmmState,
  fairOf: (leg: Leg, index: number) => number,
  params: ImpactParams,
): number {
  return legs.reduce((sum, leg, index) => sum + legCost(fairOf(leg, index), state.mtm, state.balance, leg.quantity, params), 0);
}

export function priceBasketSequential(
  legs: Leg[],
  state: AmmState,
  fairOf: (leg: Leg, index: number) => number,
  params: ImpactParams,
): BasketPricing {
  const order = legs.map((_, index) => index);
  const naive = priceBasketNaive(legs, state, fairOf, params);
  const sequential = priceInOrder(legs, order, state, fairOf, params);
  return { naive, sequential, impactCost: sequential - naive };
}

function reconstructOrder(prev: Int32Array, n: number): number[] {
  const out: number[] = [];
  let mask = (1 << n) - 1;
  while (mask !== 0) {
    const last = prev[mask];
    out.push(last);
    mask ^= 1 << last;
  }
  return out.reverse();
}

export function optimalOrder(
  legs: Leg[],
  state: AmmState,
  fairOf: (leg: Leg, index: number) => number,
  params: ImpactParams,
): OrderedBasket {
  const n = legs.length;
  if (n === 0) return { order: [], totalCost: 0 };
  if (n > 12) return greedyOrder(legs, state, fairOf, params);

  const exposures = exposureFor(legs, fairOf);
  const size = 1 << n;
  const exposureByMask = new Float64Array(size);
  for (let mask = 1; mask < size; mask += 1) {
    const bit = mask & -mask;
    const index = Math.log2(bit);
    exposureByMask[mask] = exposureByMask[mask ^ bit] + exposures[index];
  }

  const dp = new Float64Array(size);
  dp.fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(size);
  prev.fill(-1);
  dp[0] = 0;

  for (let mask = 0; mask < size; mask += 1) {
    if (!Number.isFinite(dp[mask])) continue;
    const runningMtm = state.mtm + exposureByMask[mask];
    for (let next = 0; next < n; next += 1) {
      if ((mask & (1 << next)) !== 0) continue;
      const nextMask = mask | (1 << next);
      const cost = dp[mask] + legCost(fairOf(legs[next], next), runningMtm, state.balance, legs[next].quantity, params);
      if (cost < dp[nextMask]) {
        dp[nextMask] = cost;
        prev[nextMask] = next;
      }
    }
  }

  return { order: reconstructOrder(prev, n), totalCost: dp[size - 1] };
}

function greedyOrder(
  legs: Leg[],
  state: AmmState,
  fairOf: (leg: Leg, index: number) => number,
  params: ImpactParams,
): OrderedBasket {
  const remaining = legs.map((_, index) => index);
  const order: number[] = [];
  let running = { ...state };
  let totalCost = 0;
  while (remaining.length > 0) {
    remaining.sort(
      (a, b) =>
        legCost(fairOf(legs[a], a), running.mtm, running.balance, legs[a].quantity, params) -
        legCost(fairOf(legs[b], b), running.mtm, running.balance, legs[b].quantity, params),
    );
    const index = remaining.shift()!;
    const fair = fairOf(legs[index], index);
    totalCost += legCost(fair, running.mtm, running.balance, legs[index].quantity, params);
    running = applyMint(running, legs[index], fair);
    order.push(index);
  }
  return { order, totalCost };
}

function projectSimplex(values: number[], total: number): number[] {
  const sorted = [...values].sort((a, b) => b - a);
  let cumsum = 0;
  let theta = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    cumsum += sorted[i];
    const candidate = (cumsum - total) / (i + 1);
    if (i === sorted.length - 1 || sorted[i + 1] <= candidate) {
      theta = candidate;
      break;
    }
  }
  return values.map((value) => Math.max(0, value - theta));
}

function splitCost(q: number[], candidates: SplitCandidate[], state: AmmState, params: ImpactParams): number {
  let running = { ...state };
  let cost = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    cost += legCost(candidates[i].fairPrice, running.mtm, running.balance, q[i], params);
    running = { ...running, mtm: running.mtm + candidates[i].fairPrice * q[i] };
  }
  return cost;
}

export function splitAcrossCandidates(
  parent: Leg,
  candidates: SplitCandidate[],
  state: AmmState,
  params: ImpactParams,
  opts: { iters?: number; step?: number } = {},
): { legs: Leg[]; totalCost: number; exposureOk: boolean } {
  if (candidates.length === 0) return { legs: [parent], totalCost: legCost(1, state.mtm, state.balance, parent.quantity, params), exposureOk: false };
  const total = parent.quantity;
  const maxExposure = (params.maxExposurePct ?? 0.8) * state.balance;
  let q = candidates.map(() => total / candidates.length);
  const step = opts.step ?? Math.max(1, total / 50);

  for (let iter = 0; iter < (opts.iters ?? DEFAULT_SPLIT_ITERS); iter += 1) {
    const base = splitCost(q, candidates, state, params);
    const grad = q.map((_, i) => {
      const bumped = [...q];
      bumped[i] += step;
      return (splitCost(bumped, candidates, state, params) - base) / step;
    });
    const lr = total / (10 + iter);
    q = projectSimplex(q.map((value, i) => value - lr * grad[i]), total);
  }

  const legs = candidates
    .map((candidate, i) => ({ ...candidate.leg, quantity: Math.round(q[i]) }))
    .filter((leg) => leg.quantity > 0);
  const drift = total - legs.reduce((sum, leg) => sum + leg.quantity, 0);
  if (drift !== 0 && legs.length > 0) legs[0].quantity += drift;
  const finalExposure = candidates.reduce((sum, candidate, i) => sum + candidate.fairPrice * q[i], state.mtm);
  return {
    legs,
    totalCost: splitCost(q, candidates, state, params),
    exposureOk: finalExposure <= maxExposure,
  };
}

export function fairFromSvi(svi: SVI, forward: number): (leg: Leg) => number {
  return (leg) => legProb(svi, forward, { ...leg, quantity: 1 });
}
