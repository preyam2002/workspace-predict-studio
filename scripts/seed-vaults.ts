import { writeFileSync } from 'node:fs';
import { catalogProducts } from '../lib/catalog';
import { optimizeSparse } from '../lib/optimizer';
import { USDC, type OracleState } from '../lib/types';

const oracle: OracleState = {
  predictId: 'fixture',
  oracleId: 'fixture',
  dbpPackage: 'fixture',
  dusdcType: 'fixture',
  expiryMs: 86_400_000,
  nowMs: 0,
  spot: 100,
  forward: 100,
  status: 'active',
  underlyingAsset: 'BTC',
  svi: { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 },
  minStrike: 70,
  tickSize: 5,
  maxStrike: 130,
};

const vaults = catalogProducts.map((product) => {
  const target = product.build(oracle);
  const quote = optimizeSparse(target, oracle.svi, oracle.forward).best;
  return {
    id: product.id,
    name: product.label,
    strategy: product.id,
    underlyingAsset: oracle.underlyingAsset,
    nav: 1,
    apr: Number((quote.premiumEst * 52).toFixed(4)),
    premiumUsd: Number(quote.premiumEst.toFixed(6)),
    maxPayoutUsd: Number((Math.max(0, ...target.g)).toFixed(6)),
    legCount: quote.legCount,
    legs: quote.legs.map((leg) => ({
      ...leg,
      quantityUsd: Number((leg.quantity / USDC).toFixed(6)),
    })),
  };
});

writeFileSync('./scripts/seed-vaults.json', `${JSON.stringify({ oracle, vaults }, null, 2)}\n`);
console.log(`seeded ${vaults.length} demo vault configs -> scripts/seed-vaults.json`);
