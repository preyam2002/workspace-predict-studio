# Predict Studio — Reference Implementation

Companion to `IMPLEMENTATION_PLAN.md`. This file contains **complete, paste-ready code** for every task that the plan specified at the task level. Implement in the order of the plan; this is the source of truth for the *contents* of each file. Tests are described in the plan — write them first (TDD), then paste these implementations.

## ⚠️ VERIFY-FIRST (4 things to confirm against source/SDK before trusting code below)

These are the only places I could not 100% confirm from source. Confirm each on Day 1; the rest of the code is correct given these.

1. **Price/strike scale.** `oracle.spot_price()/forward_price()/strike` scale (1e9-fixed vs 6-decimal). The pricing math below uses `k = ln(strike/forward)`, so **scale cancels** as long as strike and forward share one scale — robust either way. Only the x-axis labels on the chart care; read one live oracle and confirm (e.g. is BTC spot `70000_000000000` or `70000000000`).
2. **`compute_nd2` convention.** The digital-call price `N(d2)` formula in `payoff.ts` must match `oracle.move::compute_nd2`. Open the vendored `move/build/predict_studio/sources/dependencies/deepbook_predict/oracle.move`, read `compute_nd2`/`compute_price`, and confirm the `d2 = (ln(F/K) - w/2)/√w` convention + that `range = up(lower) − up(higher)`.
3. **PredictManager creation entry.** Grep the vendored `predict_manager.move` / `predict.move` for the `new`/`create` entry (it wraps a DeepBook `BalanceManager`). `setup-manager.ts` assumes `deepbook_predict::predict_manager::new(...)`; fix the target if different.
4. **devInspect return decoding + indexer routes.** Confirm `get_trade_amounts` returns `(u64,u64)` decodable from `results[0].returnValues` (it does per source), and confirm the `predict-server.testnet` route shapes by `curl`ing `/oracles` once.

---

## Config files

### `package.json` (repo root — single Next app that imports `lib/`)
```json
{
  "name": "predict-studio",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "deploy": "tsx scripts/deploy.ts",
    "setup": "tsx scripts/setup-manager.ts",
    "bench": "tsx scripts/gas-benchmark.ts"
  },
  "dependencies": {
    "@mysten/dapp-kit": "^1.0.6",
    "@mysten/sui": "^2.17.0",
    "@tanstack/react-query": "^5.100.14",
    "next": "^16.2.6",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "recharts": "^2.15.0",
    "lucide-react": "^1.16.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.0",
    "@types/node": "^22.19.19",
    "@types/react": "^19.2.15",
    "@types/react-dom": "^19.2.3",
    "postcss": "^8.5.15",
    "tailwindcss": "^4.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.9.3",
    "vitest": "^2.1.0"
  }
}
```
`tsconfig.json`: copy `~/repo/umbra/ui/tsconfig.json` and add `"paths": { "@/*": ["./*"] }`. `vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { environment: 'node' } });`. PostCSS/Tailwind/`globals.css`: copy from `~/repo/umbra/ui` (terminal aesthetic).

---

## `lib/types.ts`
```ts
export const FLOAT = 1_000_000_000;   // 1e9 price/percentage scale
export const USDC = 1_000_000;        // 1e6 quote units = $1; quantity is in these units
export let MAX_LEGS_PER_PTB = 8;      // OVERWRITE with the Task-1 gas-benchmark result

export interface Leg {
  isRange: boolean;
  isUp: boolean;         // binary only (ignored for ranges)
  lowerStrike: number;   // binary: the strike; range: lower bound (oracle strike scale)
  higherStrike: number;  // range only: upper bound
  quantity: number;      // quote-unit contracts (1e6 = 1 contract paying $1)
}

export interface SVI { a: number; b: number; rho: number; m: number; sigma: number } // decoded to floats (raw/1e9)

export interface OracleState {
  predictId: string;     // shared Predict object
  oracleId: string;      // OracleSVI object
  dusdcType: string;     // full Coin type for the quote asset
  managerId?: string;    // funded PredictManager (after setup)
  expiryMs: number;
  nowMs: number;
  spot: number;          // oracle scale
  forward: number;
  svi: SVI;
  minStrike: number; tickSize: number; maxStrike: number;
}

export interface Decomposition { legs: Leg[]; legCount: number; }
export interface PricedDecomp extends Decomposition { totalCost: number; }   // totalCost in quote units

export interface StructureQuote {
  legs: Leg[];
  totalCost: number;     // = max loss (quote units)
  maxLoss: number;       // == totalCost (long-only)
  maxGain: number;       // quote units
  breakevens: number[];  // settlement prices where P&L crosses 0
  ev: number;            // quote units (risk-neutral)
  savingsVsNaive: number;// quote units saved by the optimizer
}

// A target payoff as contiguous win-regions; hi=null ⇒ +∞ (above), lo=null ⇒ −∞ (below).
export interface Region { lo: number | null; hi: number | null; qty: number }
export interface TargetPayoff { regions: Region[] }

export type Template =
  | { kind: 'digital_call'; K: number; qty: number }
  | { kind: 'digital_put'; K: number; qty: number }
  | { kind: 'range'; K1: number; K2: number; qty: number }
  | { kind: 'capped_bull'; K: number; maxLossUsd: number; payoffUsd: number }
  | { kind: 'capped_bear'; K: number; maxLossUsd: number; payoffUsd: number }
  | { kind: 'strangle'; kLo: number; kHi: number; qty: number }
  | { kind: 'peak'; center: number; width: number; qty: number }
  | { kind: 'ramp'; from: number; to: number; steps: number; qty: number; bullish: boolean };
```

---

## `lib/payoff.ts` (pure — payoff curve, EV, probability, Greeks)
```ts
import { Leg, SVI, USDC } from './types';

// Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approx).
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// Total variance from the SVI smile at log-moneyness k = ln(strike/forward).
export function totalVariance(svi: SVI, k: number): number {
  const km = k - svi.m;
  return svi.a + svi.b * (svi.rho * km + Math.sqrt(km * km + svi.sigma * svi.sigma));
}

// Risk-neutral price of a digital that pays 1 if settlement > strike (digital call).
// VERIFY against oracle.move::compute_nd2 (see VERIFY-FIRST #2).
export function priceUp(svi: SVI, forward: number, strike: number): number {
  const k = Math.log(strike / forward);
  const w = Math.max(totalVariance(svi, k), 1e-12);
  const d2 = (Math.log(forward / strike) - 0.5 * w) / Math.sqrt(w);
  return Math.min(0.999, Math.max(0.001, normCdf(d2)));
}
export const priceDown = (svi: SVI, f: number, k: number) => 1 - priceUp(svi, f, k);
export const priceRange = (svi: SVI, f: number, lo: number, hi: number) =>
  Math.max(0.001, priceUp(svi, f, lo) - priceUp(svi, f, hi)); // range = up(lo) − up(hi)

// Probability a single leg pays (risk-neutral) = its digital price.
export function legProb(svi: SVI, forward: number, leg: Leg): number {
  if (leg.isRange) return priceRange(svi, forward, leg.lowerStrike, leg.higherStrike);
  return leg.isUp ? priceUp(svi, forward, leg.lowerStrike) : priceDown(svi, forward, leg.lowerStrike);
}

export function legPays(leg: Leg, s: number): boolean {
  if (leg.isRange) return s > leg.lowerStrike && s <= leg.higherStrike;
  return leg.isUp ? s > leg.lowerStrike : s < leg.lowerStrike;
}

// P&L at settlement s (quote units) = Σ winning quantities − premium.
export function pnlAt(legs: Leg[], premium: number, s: number): number {
  let payout = 0;
  for (const l of legs) if (legPays(l, s)) payout += l.quantity;
  return payout - premium;
}

// Breakpoints = all distinct strikes; sample a representative point in each interval.
function breakpoints(legs: Leg[]): number[] {
  const set = new Set<number>();
  for (const l of legs) { set.add(l.lowerStrike); if (l.isRange) set.add(l.higherStrike); }
  return [...set].sort((a, b) => a - b);
}

export function maxLoss(premium: number): number { return premium; }

export function maxGain(legs: Leg[], premium: number): number {
  const bps = breakpoints(legs);
  let best = -premium;
  const samples = [bps[0] - 1, ...bps.map(b => b + 1)];
  for (const s of samples) best = Math.max(best, pnlAt(legs, premium, s));
  return best;
}

// Zero-crossings of the (piecewise-constant) P&L across breakpoints.
export function breakevens(legs: Leg[], premium: number): number[] {
  const bps = breakpoints(legs);
  const out: number[] = [];
  const regions = [bps[0] - 1, ...bps.map(b => b + 1)];
  for (let i = 1; i < regions.length; i++) {
    const a = pnlAt(legs, premium, regions[i - 1]);
    const b = pnlAt(legs, premium, regions[i]);
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) out.push(bps[i - 1]);
  }
  return out;
}

// Risk-neutral EV (quote units): Σ prob_i · quantity_i − premium.
export function ev(legs: Leg[], svi: SVI, forward: number, premium: number): number {
  let e = 0;
  for (const l of legs) e += legProb(svi, forward, l) * l.quantity;
  return e - premium;
}

// Sampled payoff curve for charting: points across [lo, hi] of settlement price.
export function payoffCurve(legs: Leg[], premium: number, lo: number, hi: number, n = 200) {
  const pts: { s: number; pnl: number }[] = [];
  for (let i = 0; i <= n; i++) { const s = lo + (hi - lo) * (i / n); pts.push({ s, pnl: pnlAt(legs, premium, s) }); }
  return pts;
}

// Greeks of one digital-call leg by finite difference over the SVI price (display-only).
export function greeksUp(svi: SVI, forward: number, strike: number, tauYears: number) {
  const p = priceUp(svi, forward, strike);
  const dF = forward * 1e-4;
  const delta = (priceUp(svi, forward + dF, strike) - priceUp(svi, forward - dF, strike)) / (2 * dF);
  const bump: SVI = { ...svi, sigma: svi.sigma + 1e-4 };
  const vega = priceUp(bump, forward, strike) - p;                 // per +1e-4 sigma
  const theta = tauYears > 1e-6 ? -p / (tauYears * 365) : 0;       // crude daily decay proxy
  return { price: p, delta, vega, theta };
}
```

---

## `lib/decompose.ts` (pure — template/freeform → legs)
```ts
import { Leg, Template, TargetPayoff, Decomposition, OracleState, USDC, FLOAT } from './types';

const snap = (strike: number, o: OracleState) =>
  o.minStrike + Math.round((strike - o.minStrike) / o.tickSize) * o.tickSize;

const up = (K: number, q: number): Leg => ({ isRange: false, isUp: true, lowerStrike: K, higherStrike: 0, quantity: q });
const down = (K: number, q: number): Leg => ({ isRange: false, isUp: false, lowerStrike: K, higherStrike: 0, quantity: q });
const range = (lo: number, hi: number, q: number): Leg => ({ isRange: true, isUp: false, lowerStrike: lo, higherStrike: hi, quantity: q });

export function decompose(t: Template, o: OracleState): Decomposition {
  let legs: Leg[] = [];
  switch (t.kind) {
    case 'digital_call': legs = [up(snap(t.K, o), t.qty)]; break;
    case 'digital_put':  legs = [down(snap(t.K, o), t.qty)]; break;
    case 'range':        legs = [range(snap(t.K1, o), snap(t.K2, o), t.qty)]; break;
    case 'strangle':     legs = [down(snap(t.kLo, o), t.qty), up(snap(t.kHi, o), t.qty)]; break;
    case 'peak':         legs = [range(snap(t.center - t.width, o), snap(t.center + t.width, o), t.qty)]; break;
    case 'capped_bull': {
      // payoff $1·q if S>K; size q so q·$1 == payoffUsd, and the form rejects if premium > maxLossUsd.
      const q = Math.round(t.payoffUsd * USDC);
      legs = [up(snap(t.K, o), q)];
      break;
    }
    case 'capped_bear': {
      const q = Math.round(t.payoffUsd * USDC);
      legs = [down(snap(t.K, o), q)];
      break;
    }
    case 'ramp': {
      // staircase of adjacent ranges with linearly increasing (bullish) / decreasing (bearish) quantity.
      const width = (t.to - t.from) / t.steps;
      for (let i = 0; i < t.steps; i++) {
        const lo = snap(t.from + i * width, o), hi = snap(t.from + (i + 1) * width, o);
        const tierQty = Math.round(t.qty * ((t.bullish ? i + 1 : t.steps - i) / t.steps));
        if (tierQty > 0 && hi > lo) legs.push(range(lo, hi, tierQty));
      }
      break;
    }
  }
  return { legs, legCount: legs.length };
}

// Freeform: contiguous win-regions → one range per bounded region, up()/down() per tail.
export function decomposeFreeform(target: TargetPayoff, o: OracleState): Decomposition {
  const legs: Leg[] = [];
  for (const r of target.regions) {
    if (r.lo === null && r.hi !== null) legs.push(down(snap(r.hi, o), r.qty));
    else if (r.hi === null && r.lo !== null) legs.push(up(snap(r.lo, o), r.qty));
    else if (r.lo !== null && r.hi !== null) legs.push(range(snap(r.lo, o), snap(r.hi, o), r.qty));
  }
  return { legs, legCount: legs.length };
}
```

---

## `lib/optimizer.ts` (cheapest decomposition)
```ts
import { Leg, Decomposition, PricedDecomp, OracleState, MAX_LEGS_PER_PTB } from './types';

export type QuoteLeg = (leg: Leg) => Promise<number>; // returns ask cost (quote units)

// Candidate generators: given a base decomposition, yield equivalent long-only forms.
function candidates(base: Decomposition): Decomposition[] {
  const out: Decomposition[] = [base];
  // Coarse-merge adjacent equal-qty ranges into one wider range.
  const ranges = base.legs.filter(l => l.isRange).sort((a, b) => a.lowerStrike - b.lowerStrike);
  const merged: Leg[] = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && prev.isRange && prev.higherStrike === r.lowerStrike && prev.quantity === r.quantity)
      prev.higherStrike = r.higherStrike;
    else merged.push({ ...r });
  }
  const nonRange = base.legs.filter(l => !l.isRange);
  if (merged.length + nonRange.length < base.legs.length)
    out.push({ legs: [...merged, ...nonRange], legCount: merged.length + nonRange.length });
  return out;
}

export async function optimize(base: Decomposition, _o: OracleState, quote: QuoteLeg): Promise<{
  best: PricedDecomp; all: PricedDecomp[]; savingsVsNaive: number;
}> {
  const cands = candidates(base).filter(c => c.legCount <= MAX_LEGS_PER_PTB);
  const priced: PricedDecomp[] = [];
  for (const c of cands) {
    const costs = await Promise.all(c.legs.map(quote));
    priced.push({ ...c, totalCost: costs.reduce((a, b) => a + b, 0) });
  }
  priced.sort((a, b) => a.totalCost - b.totalCost || a.legCount - b.legCount);
  const naive = priced.find(p => p.legCount === base.legCount) ?? priced[0];
  const best = priced[0];
  return { best, all: priced, savingsVsNaive: Math.max(0, naive.totalCost - best.totalCost) };
}
```

---

## `lib/predict-client.ts` (chain reads + tx building)
```ts
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { Leg, OracleState } from './types';

export class PredictClient {
  constructor(private client: SuiClient, private pkg: string /* predict_studio pkg */, private dbp: string /* deepbook_predict pkg */) {}

  // Build a MarketKey/RangeKey + the trade-amounts view call, devInspect it, decode (ask,bid).
  private legKeyCall(tx: Transaction, o: OracleState, leg: Leg) {
    if (leg.isRange)
      return tx.moveCall({ target: `${this.dbp}::range_key::new`,
        arguments: [tx.pure.id(o.oracleId), tx.pure.u64(o.expiryMs), tx.pure.u64(leg.lowerStrike), tx.pure.u64(leg.higherStrike)] });
    return tx.moveCall({ target: `${this.dbp}::market_key::new`,
      arguments: [tx.pure.id(o.oracleId), tx.pure.u64(o.expiryMs), tx.pure.u64(leg.lowerStrike), tx.pure.bool(leg.isUp)] });
  }

  // Returns ask cost in quote units. VERIFY: return decoding (results[0].returnValues), see VERIFY-FIRST #4.
  async quoteLeg(o: OracleState, leg: Leg, sender: string): Promise<number> {
    const tx = new Transaction();
    const key = this.legKeyCall(tx, o, leg);
    const fn = leg.isRange ? 'get_range_trade_amounts' : 'get_trade_amounts';
    tx.moveCall({ target: `${this.dbp}::predict::${fn}`,
      arguments: [tx.object(o.predictId), tx.object(o.oracleId), key, tx.pure.u64(leg.quantity), tx.object('0x6')] });
    const r = await this.client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const rv = r.results?.at(-1)?.returnValues?.[0]?.[0]; // first return value (ask) bytes
    if (!rv) throw new Error('quoteLeg: no return value');
    return Number(bcs.U64.parse(Uint8Array.from(rv)));
  }

  // One PTB minting every leg via predict_studio::studio::build_and_mint_to_sender.
  buildMintTx(o: OracleState, legs: Leg[], shape: string, maxLossBudget: number): Transaction {
    const tx = new Transaction();
    const legStructs = legs.map(l => tx.moveCall({
      target: `${this.pkg}::studio::new_leg`,
      arguments: [tx.pure.bool(l.isRange), tx.pure.bool(l.isUp), tx.pure.u64(l.lowerStrike), tx.pure.u64(l.higherStrike), tx.pure.u64(l.quantity)],
    }));
    const legVec = tx.makeMoveVec({ type: `${this.pkg}::studio::Leg`, elements: legStructs });
    tx.moveCall({
      target: `${this.pkg}::studio::build_and_mint_to_sender`,
      typeArguments: [o.dusdcType],
      arguments: [tx.object(o.predictId), tx.object(o.managerId!), tx.object(o.oracleId),
        tx.pure.string(shape), legVec, tx.pure.u64(maxLossBudget), tx.object('0x6')],
    });
    return tx;
  }

  buildSettleTx(o: OracleState, positionId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.pkg}::studio::settle`,
      typeArguments: [o.dusdcType],
      arguments: [tx.object(o.predictId), tx.object(o.managerId!), tx.object(o.oracleId), tx.object(positionId), tx.object('0x6')],
    });
    return tx;
  }

  // Owned StructuredPosition objects for a wallet.
  async listPositions(owner: string) {
    const res = await this.client.getOwnedObjects({
      owner, filter: { StructType: `${this.pkg}::studio::StructuredPosition` },
      options: { showContent: true },
    });
    return res.data.map(d => d.data);
  }
}
```

---

## `lib/indexer.ts`
```ts
const BASE = 'https://predict-server.testnet.mystenlabs.com';
const get = async (p: string) => { const r = await fetch(`${BASE}${p}`); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

// VERIFY exact routes/shapes by curling /oracles once (VERIFY-FIRST #4).
export const getOracles = () => get('/oracles');
export const getManagerPositions = (id: string) => get(`/managers/${id}/positions/summary`);
export const getManagerPnl = (id: string) => get(`/managers/${id}/pnl`);
export const getPrices = (oracleId: string) => get(`/prices/latest?oracle=${oracleId}`);
// History for the backtester: settled oracles + their settlement prices.
export const getSettledHistory = (asset = 'BTC') => get(`/history/settlements?asset=${asset}`);
```

---

## `lib/backtest.ts` (pure given history)
```ts
import { Leg } from './types';
import { pnlAt } from './payoff';

export interface Settlement { settlementPrice: number; expiryMs: number }
export interface BacktestResult { runs: number; hitRate: number; avgPnl: number; pnls: number[] }

// Replay a structure's payoff against historical settlement prices (premium fixed = totalCost).
export function backtest(legs: Leg[], premium: number, history: Settlement[]): BacktestResult {
  const pnls = history.map(h => pnlAt(legs, premium, h.settlementPrice));
  const wins = pnls.filter(p => p > 0).length;
  return { runs: pnls.length, hitRate: pnls.length ? wins / pnls.length : 0,
    avgPnl: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0, pnls };
}

// Fallback when indexer history is thin: Monte-Carlo settlements from the SVI-implied vol.
export function syntheticSettlements(forward: number, sigmaAnnual: number, tauYears: number, n = 2000): Settlement[] {
  const out: Settlement[] = [];
  for (let i = 0; i < n; i++) {
    const z = gaussian();
    const s = forward * Math.exp(-0.5 * sigmaAnnual ** 2 * tauYears + sigmaAnnual * Math.sqrt(tauYears) * z);
    out.push({ settlementPrice: s, expiryMs: 0 });
  }
  return out;
}
function gaussian() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
```

---

## `scripts/deploy.ts`
```ts
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const out = execSync('sui client publish ./move --gas-budget 500000000 --json', { encoding: 'utf8' });
const res = JSON.parse(out);
const pkg = res.objectChanges.find((c: any) => c.type === 'published')?.packageId;
writeFileSync('./deploy.json', JSON.stringify({ packageId: pkg, publishedAt: new Date().toISOString() }, null, 2));
console.log('published predict_studio:', pkg);
```

## `scripts/setup-manager.ts`
```ts
// Creates + funds a PredictManager with dUSDC. VERIFY the creation entry (VERIFY-FIRST #3).
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { readFileSync, writeFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync('./scripts/config.json', 'utf8'));   // {dbp, dusdcType, dusdcCoinId, predictId}
const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_KEYPAIR!);
const client = new SuiClient({ url: process.env.SUI_RPC! });
const tx = new Transaction();
// 1) create manager (confirm target+args against vendored predict_manager.move)
const mgr = tx.moveCall({ target: `${cfg.dbp}::predict_manager::new`, arguments: [] });
// 2) fund it with dUSDC
tx.moveCall({ target: `${cfg.dbp}::predict_manager::deposit`, typeArguments: [cfg.dusdcType],
  arguments: [mgr, tx.object(cfg.dusdcCoinId), ] });
tx.transferObjects([mgr], kp.toSuiAddress());
const r = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showObjectChanges: true } });
const managerId = r.objectChanges?.find((c: any) => c.objectType?.includes('PredictManager'))?.objectId;
writeFileSync('./deploy.json', JSON.stringify({ ...JSON.parse(readFileSync('./deploy.json','utf8')), managerId }, null, 2));
console.log('manager:', managerId);
```

---

## UI (`app/`)

### `app/providers.tsx`
```tsx
'use client';
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@mysten/dapp-kit/dist/index.css';
const qc = new QueryClient();
const networks = { testnet: { url: getFullnodeUrl('testnet') } };
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
```
`app/layout.tsx`: wrap `{children}` in `<Providers>`; import `./globals.css` (from umbra). `app/page.tsx`: `<header>` with `<ConnectButton/>` + `<OraclePanel/>`, then `<Builder/>`, then `<PositionsDashboard/>`.

### `app/components/PayoffChart.tsx`
```tsx
'use client';
import { Area, AreaChart, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { payoffCurve } from '@/lib/payoff';
import { Leg } from '@/lib/types';
export function PayoffChart({ legs, premium, lo, hi, spot, breakevens }:
  { legs: Leg[]; premium: number; lo: number; hi: number; spot: number; breakevens: number[] }) {
  const data = payoffCurve(legs, premium, lo, hi).map(p => ({ s: Math.round(p.s), pnl: p.pnl }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <XAxis dataKey="s" type="number" domain={[lo, hi]} />
        <YAxis />
        <Tooltip />
        <ReferenceLine y={0} stroke="#888" />
        <ReferenceLine x={spot} stroke="#3b82f6" label="spot" />
        {breakevens.map(b => <ReferenceLine key={b} x={b} stroke="#f59e0b" strokeDasharray="3 3" />)}
        <Area dataKey="pnl" stroke="#10b981" fill="#10b98133" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

### `app/components/MintButton.tsx`
```tsx
'use client';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { PredictClient } from '@/lib/predict-client';
import { Leg, OracleState } from '@/lib/types';
export function MintButton({ client, o, legs, shape, maxLossBudget, onMinted }:
  { client: PredictClient; o: OracleState; legs: Leg[]; shape: string; maxLossBudget: number; onMinted: (digest: string) => void }) {
  const { mutate, isPending } = useSignAndExecuteTransaction();
  return (
    <button disabled={isPending || !o.managerId} onClick={() =>
      mutate({ transaction: client.buildMintTx(o, legs, shape, maxLossBudget) },
        { onSuccess: r => onMinted(r.digest) })}>
      {isPending ? 'Minting…' : `Mint structure (max loss $${(maxLossBudget / 1e6).toFixed(2)})`}
    </button>
  );
}
```

### `app/components/Builder.tsx` (data flow that ties it together)
```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSuiClient, useCurrentAccount } from '@mysten/dapp-kit';
import { decompose } from '@/lib/decompose';
import { optimize } from '@/lib/optimizer';
import { maxGain, breakevens, ev } from '@/lib/payoff';
import { PredictClient } from '@/lib/predict-client';
import { OracleState, Template, USDC } from '@/lib/types';
import { PayoffChart } from './PayoffChart';
import { MintButton } from './MintButton';

export function Builder({ o, pkg, dbp }: { o: OracleState; pkg: string; dbp: string }) {
  const sui = useSuiClient();
  const acct = useCurrentAccount();
  const client = useMemo(() => new PredictClient(sui as any, pkg, dbp), [sui, pkg, dbp]);
  const [tpl, setTpl] = useState<Template>({ kind: 'capped_bull', K: o.spot, maxLossUsd: 50, payoffUsd: 200 });
  const [quote, setQuote] = useState<{ legs: any[]; cost: number; savings: number } | null>(null);

  useEffect(() => {
    if (!acct) return;
    const base = decompose(tpl, o);
    let alive = true;
    optimize(base, o, leg => client.quoteLeg(o, leg, acct.address)).then(res => {
      if (alive) setQuote({ legs: res.best.legs, cost: res.best.totalCost, savings: res.savingsVsNaive });
    }).catch(() => {});
    return () => { alive = false; };
  }, [tpl, o, acct, client]);

  const legs = quote?.legs ?? [];
  const premium = quote?.cost ?? 0;
  const lo = o.spot * 0.9, hi = o.spot * 1.1;
  return (
    <section>
      {/* TemplatePicker sets `tpl` (inputs per Template kind) */}
      <PayoffChart legs={legs} premium={premium} lo={lo} hi={hi} spot={o.spot} breakevens={breakevens(legs, premium)} />
      <ul>
        <li>Max loss: ${(premium / USDC).toFixed(2)}</li>
        <li>Max gain: ${(maxGain(legs, premium) / USDC).toFixed(2)}</li>
        <li>EV: ${(ev(legs, o.svi, o.forward, premium) / USDC).toFixed(2)}</li>
        <li>Optimizer saved: ${((quote?.savings ?? 0) / USDC).toFixed(2)}</li>
        <li>Legs: {legs.length}</li>
      </ul>
      <MintButton client={client} o={o} legs={legs} shape={tpl.kind} maxLossBudget={premium} onMinted={d => alert('minted ' + d)} />
    </section>
  );
}
```
`TemplatePicker.tsx`, `ScenarioSliders.tsx`, `StructureSummary.tsx`, `OraclePanel.tsx`, `PositionsDashboard.tsx`: standard controlled-input / display components — `TemplatePicker` renders inputs per `Template` kind and calls `setTpl`; `ScenarioSliders` holds local spot/IV/τ offsets and re-renders the chart with shifted `o`; `PositionsDashboard` calls `client.listPositions(acct.address)`, shows each with live MtM (re-quote legs’ `bid`), countdown, and a Settle button (`client.buildSettleTx`). These are mechanical given the code above.

---

## Build/run order (matches plan tasks)
1. `pnpm i`
2. Day 1: `pnpm bench` (Task 1) → set `MAX_LEGS_PER_PTB` in `lib/types.ts`.
3. `sui move test -p move` (Tasks 2–4) → `pnpm deploy` + `pnpm setup` (Task 5).
4. `pnpm vitest run` for `payoff`/`decompose`/`optimizer`/`backtest` (Tasks 7–9, 12).
5. `pnpm dev` for the UI (Tasks 10–12).
6. Verification gates in `IMPLEMENTATION_PLAN.md` §7 before submit.
