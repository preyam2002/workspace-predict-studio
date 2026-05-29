import { USDC, type Decomposition, type Leg, type OracleState, type TargetPayoff, type Template } from './types';

export function snapStrike(strike: number, oracle: Pick<OracleState, 'minStrike' | 'tickSize' | 'maxStrike'>): number {
  const snapped = oracle.minStrike + Math.round((strike - oracle.minStrike) / oracle.tickSize) * oracle.tickSize;
  return Math.min(oracle.maxStrike, Math.max(oracle.minStrike, snapped));
}

export const up = (strike: number, quantity: number): Leg => ({
  isRange: false,
  isUp: true,
  lowerStrike: strike,
  higherStrike: 0,
  quantity,
});

export const down = (strike: number, quantity: number): Leg => ({
  isRange: false,
  isUp: false,
  lowerStrike: strike,
  higherStrike: 0,
  quantity,
});

export const range = (lo: number, hi: number, quantity: number): Leg => ({
  isRange: true,
  isUp: false,
  lowerStrike: Math.min(lo, hi),
  higherStrike: Math.max(lo, hi),
  quantity,
});

export function decompose(template: Template, oracle: OracleState): Decomposition {
  let legs: Leg[] = [];

  switch (template.kind) {
    case 'digital_call':
      legs = [up(snapStrike(template.K, oracle), template.qty)];
      break;
    case 'digital_put':
      legs = [down(snapStrike(template.K, oracle), template.qty)];
      break;
    case 'range':
      legs = [range(snapStrike(template.K1, oracle), snapStrike(template.K2, oracle), template.qty)];
      break;
    case 'strangle':
      legs = [down(snapStrike(template.kLo, oracle), template.qty), up(snapStrike(template.kHi, oracle), template.qty)];
      break;
    case 'peak':
      legs = [
        range(
          snapStrike(template.center - template.width, oracle),
          snapStrike(template.center + template.width, oracle),
          template.qty,
        ),
      ];
      break;
    case 'capped_bull':
      legs = [up(snapStrike(template.K, oracle), Math.round(template.payoffUsd * USDC))];
      break;
    case 'capped_bear':
      legs = [down(snapStrike(template.K, oracle), Math.round(template.payoffUsd * USDC))];
      break;
    case 'ramp': {
      const steps = Math.max(1, Math.floor(template.steps));
      const width = (template.to - template.from) / steps;
      for (let i = 0; i < steps; i += 1) {
        const lo = snapStrike(template.from + i * width, oracle);
        const hi = snapStrike(template.from + (i + 1) * width, oracle);
        const tier = template.bullish ? i + 1 : steps - i;
        const quantity = Math.round(template.qty * (tier / steps));
        if (quantity > 0 && hi > lo) legs.push(range(lo, hi, quantity));
      }
      break;
    }
  }

  return { legs, legCount: legs.length };
}

export function decomposeFreeform(target: TargetPayoff, oracle: OracleState): Decomposition {
  const legs: Leg[] = [];

  for (const region of target.regions) {
    if (region.lo === null && region.hi !== null) {
      legs.push(down(snapStrike(region.hi, oracle), region.qty));
    } else if (region.hi === null && region.lo !== null) {
      legs.push(up(snapStrike(region.lo, oracle), region.qty));
    } else if (region.lo !== null && region.hi !== null) {
      legs.push(range(snapStrike(region.lo, oracle), snapStrike(region.hi, oracle), region.qty));
    }
  }

  return { legs, legCount: legs.length };
}
