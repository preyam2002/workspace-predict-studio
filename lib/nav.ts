import { legProb } from './payoff';
import type { Leg, SVI } from './types';

export function markLegs(legs: Leg[], svi: SVI, forward: number): number {
  return legs.reduce((sum, leg) => sum + legProb(svi, forward, leg) * leg.quantity, 0);
}

export function markVaultNav({
  idle,
  legs,
  svi,
  forward,
}: {
  idle: number;
  legs: Leg[];
  svi: SVI;
  forward: number;
}): number {
  return idle + markLegs(legs, svi, forward);
}
