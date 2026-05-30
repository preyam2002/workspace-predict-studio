import { markLegs } from './nav';
import type { Leg, SVI } from './types';

export interface PortfolioPosition {
  id?: string;
  legs: Leg[];
  premium: number;
  worstCaseFloor?: number;
}

export interface PortfolioNav {
  nav: number;
  premiumPaid: number;
  worstCaseFloor: number;
  delta: number;
  vega: number;
}

export interface ScenarioCell {
  spotShockPct: number;
  ivShockPct: number;
  nav: number;
  pnl: number;
}

export function portfolioNav(positions: PortfolioPosition[], svi: SVI, forward: number): PortfolioNav {
  const nav = positions.reduce((sum, position) => sum + markLegs(position.legs, svi, forward), 0);
  const premiumPaid = positions.reduce((sum, position) => sum + position.premium, 0);
  const worstCaseFloor = positions.reduce((sum, position) => sum + (position.worstCaseFloor ?? 0), 0);
  const dF = Math.max(1, Math.abs(forward) * 1e-4);
  const up = positions.reduce((sum, position) => sum + markLegs(position.legs, svi, forward + dF), 0);
  const down = positions.reduce((sum, position) => sum + markLegs(position.legs, svi, forward - dF), 0);
  const volBump = { ...svi, sigma: svi.sigma + 1e-4 };
  const bumped = positions.reduce((sum, position) => sum + markLegs(position.legs, volBump, forward), 0);

  return {
    nav,
    premiumPaid,
    worstCaseFloor,
    delta: (up - down) / (2 * dF),
    vega: bumped - nav,
  };
}

export function scenarioGrid(
  positions: PortfolioPosition[],
  svi: SVI,
  forward: number,
  spotShocksPct = [-20, -10, 0, 10, 20],
  ivShocksPct = [-25, 0, 50],
): ScenarioCell[] {
  const base = portfolioNav(positions, svi, forward).nav;
  const out: ScenarioCell[] = [];
  for (const ivShockPct of ivShocksPct) {
    for (const spotShockPct of spotShocksPct) {
      const shockedSvi = { ...svi, sigma: Math.max(1e-9, svi.sigma * (1 + ivShockPct / 100)) };
      const shockedForward = forward * (1 + spotShockPct / 100);
      const nav = portfolioNav(positions, shockedSvi, shockedForward).nav;
      out.push({ spotShockPct, ivShockPct, nav, pnl: nav - base });
    }
  }
  return out;
}

export function borrowCapacity(positions: PortfolioPosition[], ltv: number): number {
  return positions.reduce((sum, position) => sum + (position.worstCaseFloor ?? 0), 0) * ltv;
}
