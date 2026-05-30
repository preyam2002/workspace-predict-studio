export const FLOAT = 1_000_000_000;
export const USDC = 1_000_000;
export const MAX_LEGS_PER_PTB = 8;

export interface Leg {
  isRange: boolean;
  isUp: boolean;
  lowerStrike: number;
  higherStrike: number;
  quantity: number;
}

export interface SVI {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface OracleState {
  predictId: string;
  oracleId: string;
  dbpPackage: string;
  dusdcType: string;
  managerId?: string;
  expiryMs: number;
  nowMs: number;
  spot: number;
  forward: number;
  status: string;
  settlementPrice?: number;
  underlyingAsset: string;
  svi: SVI;
  minStrike: number;
  tickSize: number;
  maxStrike: number;
}

export interface Decomposition {
  legs: Leg[];
  legCount: number;
}

export interface PricedDecomp extends Decomposition {
  totalCost: number;
}

export interface StructureQuote {
  legs: Leg[];
  totalCost: number;
  maxLoss: number;
  maxGain: number;
  breakevens: number[];
  ev: number;
  savingsVsNaive: number;
}

export interface Region {
  lo: number | null;
  hi: number | null;
  qty: number;
}

export interface TargetPayoff {
  regions: Region[];
}

/** A target payoff sampled on the strike grid: g[i] = payoff USD at gridStrikes[i]. */
export interface SparseTarget {
  gridStrikes: number[];
  g: number[];
}

export interface SparseSolution {
  legs: Leg[];
  l2Error: number;
  maxAbsError: number;
  premiumEst: number;
  legCount: number;
}

export type Template =
  | { kind: 'digital_call'; K: number; qty: number }
  | { kind: 'digital_put'; K: number; qty: number }
  | { kind: 'range'; K1: number; K2: number; qty: number }
  | { kind: 'capped_bull'; K: number; maxLossUsd: number; payoffUsd: number }
  | { kind: 'capped_bear'; K: number; maxLossUsd: number; payoffUsd: number }
  | { kind: 'strangle'; kLo: number; kHi: number; qty: number }
  | { kind: 'peak'; center: number; width: number; qty: number }
  | { kind: 'ramp'; from: number; to: number; steps: number; qty: number; bullish: boolean };

export type TemplateKind = Template['kind'];
