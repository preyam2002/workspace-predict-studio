import type { OracleState, SparseTarget } from './types';

export type CatalogProductId =
  | 'capped_bull_note'
  | 'capped_bear_note'
  | 'digital_call_note'
  | 'digital_put_note'
  | 'iron_condor_income'
  | 'twin_win'
  | 'shark_fin'
  | 'fixed_coupon_range'
  | 'digital_ladder'
  | 'barrier_box'
  | 'butterfly_pin'
  | 'dual_range_barbell';

export interface CatalogProduct {
  id: CatalogProductId;
  label: string;
  build: (oracle: OracleState) => SparseTarget;
}

function sampledGrid(oracle: OracleState): number[] {
  const center = Math.round(oracle.forward / oracle.tickSize) * oracle.tickSize;
  const out: number[] = [];
  for (let i = -6; i <= 6; i += 1) {
    out.push(Math.min(oracle.maxStrike, Math.max(oracle.minStrike, center + i * oracle.tickSize)));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function target(oracle: OracleState, fn: (s: number, grid: number[]) => number): SparseTarget {
  const gridStrikes = sampledGrid(oracle);
  return { gridStrikes, g: gridStrikes.map((s) => Math.max(0, fn(s, gridStrikes))) };
}

const between = (s: number, lo: number, hi: number) => (s > lo && s <= hi ? 1 : 0);

export const catalogProducts: CatalogProduct[] = [
  {
    id: 'capped_bull_note',
    label: 'Capped Bull Note',
    build: (oracle) => target(oracle, (s) => (s > oracle.forward ? 1 : 0)),
  },
  {
    id: 'capped_bear_note',
    label: 'Capped Bear Note',
    build: (oracle) => target(oracle, (s) => (s < oracle.forward ? 1 : 0)),
  },
  {
    id: 'digital_call_note',
    label: 'Digital Call Note',
    build: (oracle) => target(oracle, (s) => (s > oracle.forward + oracle.tickSize ? 1 : 0)),
  },
  {
    id: 'digital_put_note',
    label: 'Digital Put Note',
    build: (oracle) => target(oracle, (s) => (s < oracle.forward - oracle.tickSize ? 1 : 0)),
  },
  {
    id: 'iron_condor_income',
    label: 'Iron Condor Income',
    build: (oracle) => target(oracle, (s) => between(s, oracle.forward - 2 * oracle.tickSize, oracle.forward + 2 * oracle.tickSize)),
  },
  {
    id: 'twin_win',
    label: 'Twin-Win',
    build: (oracle) => target(oracle, (s) => (s < oracle.forward - 3 * oracle.tickSize || s > oracle.forward + 3 * oracle.tickSize ? 1 : 0)),
  },
  {
    id: 'shark_fin',
    label: 'Shark-Fin',
    build: (oracle) =>
      target(oracle, (s) => Math.min(1, Math.max(0, (s - (oracle.forward - 2 * oracle.tickSize)) / (4 * oracle.tickSize)))),
  },
  {
    id: 'fixed_coupon_range',
    label: 'Fixed-Coupon Range Note',
    build: (oracle) => target(oracle, (s) => 0.25 + between(s, oracle.forward - 2 * oracle.tickSize, oracle.forward + 2 * oracle.tickSize)),
  },
  {
    id: 'digital_ladder',
    label: 'Digital Ladder',
    build: (oracle) =>
      target(oracle, (s) =>
        [oracle.forward - 2 * oracle.tickSize, oracle.forward, oracle.forward + 2 * oracle.tickSize].reduce(
          (sum, strike) => sum + (s > strike ? 0.5 : 0),
          0,
        ),
      ),
  },
  {
    id: 'barrier_box',
    label: 'Barrier Box',
    build: (oracle) =>
      target(
        oracle,
        (s) =>
          between(s, oracle.forward - 4 * oracle.tickSize, oracle.forward + 4 * oracle.tickSize) +
          between(s, oracle.forward - oracle.tickSize, oracle.forward + oracle.tickSize),
      ),
  },
  {
    id: 'butterfly_pin',
    label: 'Butterfly Pin',
    build: (oracle) =>
      target(oracle, (s) => Math.max(0, 1 - Math.abs(s - oracle.forward) / (3 * oracle.tickSize))),
  },
  {
    id: 'dual_range_barbell',
    label: 'Dual-Range Barbell',
    build: (oracle) =>
      target(
        oracle,
        (s) =>
          between(s, oracle.forward - 5 * oracle.tickSize, oracle.forward - 3 * oracle.tickSize) +
          between(s, oracle.forward + 3 * oracle.tickSize, oracle.forward + 5 * oracle.tickSize),
      ),
  },
];

export function buildCatalogTarget(id: CatalogProductId, oracle: OracleState): SparseTarget {
  const product = catalogProducts.find((item) => item.id === id);
  if (!product) throw new Error(`Unknown catalog product: ${id}`);
  return product.build(oracle);
}
