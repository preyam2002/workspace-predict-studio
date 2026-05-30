# Predict Studio Protocol — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This is a **master plan** for a multi-subsystem protocol. Phases 1–2 are fully TDD-specified (offline-verifiable, build now). Phases 3–7 are task-broken with exact specs but carry `VERIFY-FIRST` gates where they touch live testnet SDKs — confirm the cited API against the deployed package before writing the call. Each phase is independently shippable and demoable.

**Goal:** Turn DeepBook Predict's account-bound binary/range option legs into a full structured-products protocol on Sui — statically-replicated defined-risk payoffs, atomically minted, wrapped into tokenized vaults that are tradeable, collateralizable, tranchable, and gas-free to buy.

**Architecture:** Six pillars on one engine. A TS **replication engine** (static decomposition + a gas-bounded NNOMP sparse solver) decides *which legs*; a Move **core** mints them atomically into a defined-risk `StructuredPosition`; a Move **vault** (`Coin<STUDIO_LP>` shares, NAV marked off the SVI surface, round-based deposit queue, HWM fees) pools capital so anyone can buy a strategy; a **composability mesh** (Enoki gasless onboarding, Pyth NAV anchor, Cetus secondary market, Walrus self-describing specs, an isolated Suilend market for defined-risk-as-collateral) makes the share a first-class Sui asset; a **PT/YT tranching** layer (Pendle-style) splits a share into fixed-coupon + upside; and a **product/UX** layer ships 12 retail-legible notes with a draw-any-payoff builder.

**Tech Stack:** Sui Move 2024.beta (`deepbook_predict` dep, rev `predict-testnet-4-16`), `@mysten/sui` ^2.17, `@mysten/dapp-kit` ^1.0.6, `@mysten/enoki`, `@pythnetwork/pyth-sui-js`, `@cetusprotocol/cetus-sui-clmm-sdk`, Walrus HTTP API, Next.js ^16 / React ^19 / Tailwind ^4, `@tanstack/react-query`, recharts; Node 26 / pnpm / tsx / vitest.

---

## 0. Context & Load-Bearing Constraints (read before any task)

These three facts, established by cross-protocol research, govern the entire design. Violating any of them produces code that cannot work on-chain.

**C1 — Predict positions are account-bound, not objects.** A user's binary/range positions live as *quantity rows inside a per-user `PredictManager`* (`predict_manager::position` / `range_position` / `balance<T>`). They are **not** `Coin`s or NFTs and **cannot be transferred** to Cetus/Suilend/Kiosk. Therefore the vault contract **owns its own `PredictManager`**, runs the strategy inside it, and the only transferable artifact is a fungible `Coin<STUDIO_LP>` minted by a `TreasuryCap` the vault custodies. *Everything composable hangs off that coin.*

**C2 — Long-only ⇒ only non-negative payoffs.** Every primitive (`U_i`, `D_i`, `R_i`) has a payoff vector in `{0,1}^{N+1}`; long-only means quantities `w ≥ 0`; a non-negative combination of non-negative vectors is non-negative everywhere. **Theorem:** a target `g` is exactly long-only replicable iff `g_i ≥ 0 ∀ i`. This is also why max-loss = premium paid (payoff floor ≥ 0). **Out of scope, permanently:** anything requiring a written/short leg — covered-call/cash-secured-put DOVs (Ribbon/Thetanuts/Friktion *core*), Lyra/Derive delta-hedged market-making vaults, Synthetix pooled-debt, HLP/Drift funding capture, true short straddles/strangles. Our vault is always the *taker/buyer*; the short side is DeepBook Predict's SVI book.

**C3 — Settlement & the SVI surface are Predict's, not ours.** We never re-implement pricing or settlement. Every leg is priced `qty · e^{-rτ} · prob(SVI)` using the *same* `OracleSVI` the market settles against; NAV uses the identical function. We read `get_trade_amounts` / `get_range_trade_amounts` for live quotes and `oracle::is_settled()` / `settlement_price` for redemption.

Verified Predict API (from vendored `deepbook_predict` source, rev `predict-testnet-4-16`):
- `predict::mint<Quote>(&mut Predict, &mut PredictManager, &OracleSVI, MarketKey, qty, &Clock, &mut TxContext)` — pays via `manager.withdraw<Quote>(cost)`, prices post-trade, asserts owner/exposure.
- `predict::mint_range<Quote>(... RangeKey ...)`, `predict::redeem<Quote>`, `redeem_permissionless<Quote>` (needs `oracle.is_settled()`), `redeem_range<Quote>`.
- Views: `get_trade_amounts(&Predict,&OracleSVI,MarketKey,qty,&Clock):(u64,u64)`, `get_range_trade_amounts(...)`, `ask_bounds(...)`.
- `market_key::new(oracle_id, expiry, strike, is_up)`, `range_key::new(oracle_id, expiry, lower, higher)`.
- `predict_manager::owner/position/range_position/balance<T>/deposit<T>/withdraw<T>`.
- `oracle::id/spot_price/forward_price/svi/svi_a..svi_sigma/expiry/settlement_price(Option<u64>)/is_settled`.
- constants: `float_scaling=1e9`, `min_ask=1%`, `max_ask=99%`, `max_total_exposure=80%`, `oracle_strike_grid_ticks=100_000`.

**Scaling conventions:** `FLOAT = 1e9` (prices/probabilities; 500_000_000 = 50%). Quantities in dUSDC quote units (6 decimals; 1_000_000 = 1 contract = $1 max payout). Winners receive `quantity` directly.

**CONFIRMED from vendored source (`deepbook_predict`, rev `predict-testnet-4-16`) — these were previously unknown and are now load-bearing:**

- **Pricing is POST-trade and path-dependent.** `predict::mint` (predict.move:219–266) inserts the position into the vault *first* (`vault.insert_position`, refresh risk), *then* quotes: `cost = math::mul(ask, quantity)` where `ask` comes from `trade_prices` (predict.move:819–854).
- **Exact ask formula** (`pricing_config.move:91–124`): `ask = fair_price + spread`, clamped to `[min_ask=1%, max_ask=99%]`, with
  ```
  variance          = fair_price · (1e9 − fair_price)              // Bernoulli, 1e9-scaled
  bernoulli_spread  = base_spread · sqrt(variance)
  utilization_spread = base_spread · utilization_multiplier · (total_mtm / balance)^2
  spread            = max(bernoulli_spread, min_spread) + utilization_spread
  ```
  `total_mtm` = vault's summed mark-to-market liability across oracles; `balance` = vault dUSDC. **Each leg you mint raises `total_mtm`, which raises the *quadratic* utilization term for the next leg** → a basket's cost is genuinely sequential/path-dependent (within an oracle). This is the concrete impact model `f(q, state)` for Phase 1B.
- **`compute_nd2` (oracle.move:400–429):** `k = ln(strike/forward)`, `w = a + b·(ρ·(k−m) + √((k−m)²+σ²))`, `d2 = −(k + w/2)/√w`, `up_price = normal_cdf(d2) = P(S_T > K)`, 1e9-scaled. **Sign convention resolved.**
- **`get_trade_amounts` returns `(mint_cost = ask·qty, redeem_payout = bid·qty)`** (predict.move:199–208). Range variant identical.
- **Exposure cap (vault.move:193–196):** aborts unless `total_mtm ≤ max_total_exposure_pct · balance` (80%), enforced per-oracle-aggregate `max_payout`. A basket must satisfy this *after* all legs.
- **Settlement (predict.move:824–830):** winner receives exactly `quantity`; win iff `settlement_price > strike` (up) / `≤ strike` (down).

**Still UNCONFIRMED (resolve in Phase 5 `VERIFY-FIRST`):** (3) the `PredictManager` creation entry function name; (4) `devInspect` return-decoding for view calls; (5) whether a vault-owned manager's balances can back a `Coin` mint without a custom escrow. These gate live integration only — Phases 1–2 do not depend on them. *(Unknowns 1 & 2 — price/strike scale and `nd2` convention — are now RESOLVED above.)*

---

## 1. The Six Pillars & Dependency Graph

```
                ┌─────────────────────────────────────────────┐
   P1 ENGINE ──▶│ payoff · decompose · NNOMP solver · optimizer │  (TS, offline)
                └───────────────┬─────────────────────────────┘
                                │ legs[]
                ┌───────────────▼──────────────┐
   P2 CORE ────▶│ studio.move: StructuredPosition│  (Move, atomic PTB mint, max-loss envelope)  [BUILT]
                └───────────────┬──────────────┘
                                │ owns
                ┌───────────────▼──────────────────────────────┐
   P3 VAULT ───▶│ vault.move: Coin<STUDIO_LP>, NAV, deposit queue,│ (Move)
                │ HWM fees, decentralized keeper                  │
                └───────┬─────────────────────┬─────────────────┘
                        │ share coin          │ NAV anchor
        ┌───────────────▼─────┐   ┌───────────▼───────────────────────────┐
 P4 TRANCHE│ pt_yt.move:       │   │ P5 MESH: enoki·pyth·cetus·walrus·suilend│
        │ split share→PT+YT    │   └───────────────────────────────────────┘
        └──────────────────────┘
                ┌─────────────────────────────────────────────┐
   P6 UX ──────▶│ builder · catalog(12) · backtester · vault mkt │  (Next.js)
                └─────────────────────────────────────────────┘
```

Build order: **P1 → P2(done) → P3 → {P4, P5} parallel → P6**. P5 sub-integrations are independent of each other.

---

## 2. File Structure (full target)

```
move/sources/
  studio.move          [BUILT]  StructuredPosition, build_and_mint, settle, max_payout
  vault.move           [P3]     StructuredVault<Quote>, shares, NAV, deposit queue, HWM fees, KeeperCap
  pt_yt.move           [P4]     split/merge a vault share into Coin<PT>+Coin<YT>, redeem at maturity
  studio_collateral.move [P5e]  isolated lending market: borrow dUSDC vs Coin<STUDIO_LP>
move/tests/
  studio_tests.move    [BUILT]
  vault_tests.move     [P3]
  pt_yt_tests.move     [P4]

lib/
  types.ts             [BUILT]  + add SparseTarget, VaultState, Tranche types (P1/P3)
  payoff.ts            [BUILT]  SVI digital pricing (priceUp/priceRange/...)
  decompose.ts         [BUILT]  templates + freeform → legs
  solver.ts            [P1]     NNOMP + NNLS gas-bounded sparse replication      ★ technical centerpiece
  optimizer.ts         [BUILT]  candidate decompositions; extend to call solver
  catalog.ts           [P6]     12 named structured products → TargetPayoff
  predict-client.ts    [BUILT]  buildMintTx/buildSettleTx/quoteLeg
  vault-client.ts      [P3]     deposit/withdraw/roll PTBs, NAV read
  tranche-client.ts    [P4]     split/merge/redeem PTBs
  nav.ts               [P3]     mark-to-market a position basket off SVI
  indexer.ts           [BUILT]  event ingestion
  backtest.ts          [BUILT]  + per-product historical replay (P6)
  enoki.ts             [P5a]    zkLogin + sponsored-tx client
  pyth.ts              [P5b]    pull-price refresh for NAV / settlement preamble
  cetus.ts             [P5c]    create STUDIO_LP/dUSDC pool, quote secondary price
  walrus.ts            [P5d]    put/get payoff-spec + backtest blobs

keeper/
  roll.ts              [P3]     permissionless settle→reselect→re-enter loop
  config.example.json

scripts/
  deploy.ts            [BUILT]  + publish vault & tranche packages (P3/P4)
  setup-manager.ts     [BUILT]
  gas-benchmark.ts     [BUILT]  legs-per-PTB vs 5M compute cap
  seed-vaults.ts       [P6]     create demo vaults across catalog

app/
  components/
    Builder.tsx        [BUILT]  + draw-any-payoff canvas → solver (P1/P6)
    PayoffChart.tsx    [BUILT]
    TemplatePicker.tsx [BUILT]  → CatalogPicker (12 products) (P6)
    ScenarioSliders.tsx[BUILT]
    PositionsDashboard.tsx [BUILT]
    Backtester.tsx     [BUILT]
    OraclePanel.tsx    [BUILT]
    MintButton.tsx     [BUILT]  + Enoki sponsored path (P5a)
    StructureSummary.tsx[BUILT]
    VaultMarket.tsx    [P6]     browse/deposit/withdraw vaults, live NAV/APR
    TranchePanel.tsx   [P6]     buy PT (fixed coupon) or YT (upside)
    SolverInspector.tsx[P6]     show "same payoff, 3 ways" cost comparison
  providers.tsx        [BUILT]  + EnokiFlowProvider (P5a)
  page.tsx, layout.tsx, globals.css [BUILT]
```

---

## PHASE 1 — NNOMP Gas-Bounded Sparse Solver  ★ technical centerpiece (offline, build now)

**Why this is the ambition kernel:** the exact decomposition (`w_i = g_i` on the range basis) is closed-form and easy. The *hard, novel* problem is: **given any drawn payoff, find the fewest gas-cheap legs whose payoff is within ε of the target, subject to `legs ≤ B` and `w ≥ 0`.** That is non-negative sparse approximation (NP-hard exactly), solved greedily by NNOMP with an NNLS inner solve. Nobody on Sui Predict does this; it powers the "draw any curve, get the cheapest fitting basket" UX and the "same payoff assembled 3 ways" cost optimizer.

**Files:**
- Create: `lib/solver.ts`
- Test: `lib/solver.test.ts`
- Modify: `lib/types.ts` (add `SparseTarget`, `SparseSolution`), `lib/optimizer.ts` (route freeform through solver)

### Task 1.1: Types for the sparse problem

- [ ] **Step 1: Add types to `lib/types.ts`**

```ts
/** A target payoff sampled on the strike grid: g[i] = payoff (USD) at gridStrikes[i]. */
export interface SparseTarget {
  gridStrikes: number[]; // ascending strike nodes (already snapped to oracle grid)
  g: number[];           // payoff value at each node, USD float; MUST be >= 0 (long-only)
}

export interface SparseSolution {
  legs: Leg[];           // selected digital legs, integer USDC quantities
  l2Error: number;       // weighted RMS replication error, USD
  maxAbsError: number;   // worst-cell abs error, USD
  premiumEst: number;    // sum qty * prob(SVI), USD
  legCount: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts && git commit -m "feat(solver): add SparseTarget/SparseSolution types"
```

### Task 1.2: NNLS inner solver (coordinate-descent, robust on 0/1 dictionaries)

Coordinate descent is chosen over Lawson–Hanson here for implementation robustness on collinear indicator columns; it is convex and converges. (The research's active-set pseudocode is the alternative if exactness is needed.)

- [ ] **Step 1: Write the failing test** in `lib/solver.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { nnls } from './solver';

describe('nnls', () => {
  it('recovers exact non-negative weights on an orthogonal (disjoint range) system', () => {
    // Two disjoint indicator columns over 4 cells; target = 3*col0 + 5*col1
    const cols = [
      Float64Array.from([1, 1, 0, 0]),
      Float64Array.from([0, 0, 1, 1]),
    ];
    const g = Float64Array.from([3, 3, 5, 5]);
    const w = Float64Array.from([1, 1, 1, 1]);
    const x = nnls(cols, g, w);
    expect(x[0]).toBeCloseTo(3, 4);
    expect(x[1]).toBeCloseTo(5, 4);
  });

  it('never returns a negative coefficient', () => {
    const cols = [Float64Array.from([1, 1, 1])];
    const g = Float64Array.from([-2, -2, -2]); // impossible to fit with x>=0
    const w = Float64Array.from([1, 1, 1]);
    const x = nnls(cols, g, w);
    expect(x[0]).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/solver.test.ts`
Expected: FAIL — `nnls` not exported.

- [ ] **Step 3: Implement `nnls` in `lib/solver.ts`**

```ts
/**
 * Non-negative least squares via projected coordinate descent.
 * Solves  min_x ||W^{1/2}(A x - g)||_2  s.t. x >= 0,  A = columns `cols`.
 * Robust on collinear {0,1} indicator dictionaries; convex, monotone-decreasing.
 */
export function nnls(
  cols: Float64Array[],
  g: Float64Array,
  w: Float64Array,
  iters = 300,
): Float64Array {
  const k = cols.length;
  const n = g.length;
  const x = new Float64Array(k);
  // residual r = g - A x  (starts at g since x=0)
  const r = Float64Array.from(g);
  // precompute weighted column self-dot:  cc[j] = sum_t w_t^2 * a_jt^2
  const cc = cols.map((a) => {
    let s = 0;
    for (let t = 0; t < n; t += 1) s += w[t] * w[t] * a[t] * a[t];
    return s || 1;
  });
  for (let it = 0; it < iters; it += 1) {
    for (let j = 0; j < k; j += 1) {
      const a = cols[j];
      // gradient step: delta = (a · W r) / cc[j]; new x_j = max(0, x_j + delta)
      let num = 0;
      for (let t = 0; t < n; t += 1) num += w[t] * w[t] * a[t] * r[t];
      const xjNew = Math.max(0, x[j] + num / cc[j]);
      const d = xjNew - x[j];
      if (d !== 0) {
        for (let t = 0; t < n; t += 1) r[t] -= d * a[t];
        x[j] = xjNew;
      }
    }
  }
  return x;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run lib/solver.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/solver.ts lib/solver.test.ts && git commit -m "feat(solver): NNLS coordinate-descent inner solve"
```

### Task 1.3: Dictionary builder (U/D/R atoms + macro range atoms)

- [ ] **Step 1: Write the failing test** (append to `lib/solver.test.ts`)

```ts
import { buildDictionary } from './solver';

describe('buildDictionary', () => {
  it('includes up, down, and disjoint range atoms over the grid', () => {
    const strikes = [100, 110, 120, 130];
    const dict = buildDictionary(strikes);
    // every atom is a 0/1 payoff vector over the 4 nodes
    for (const atom of dict) {
      expect(atom.payoff.length).toBe(4);
      for (const v of atom.payoff) expect(v === 0 || v === 1).toBe(true);
    }
    // an up-atom at the lowest strike pays on all-but-below cells
    const upLow = dict.find((d) => d.leg.isUp && !d.leg.isRange && d.leg.lowerStrike === 100);
    expect(upLow).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm vitest run lib/solver.test.ts` — FAIL: `buildDictionary` not exported.

- [ ] **Step 3: Implement** in `lib/solver.ts` (uses `legPays` from `./payoff`, leg builders from `./decompose`)

```ts
import { legPays } from './payoff';
import { up, down, range } from './decompose';
import type { Leg } from './types';

export interface Atom {
  leg: Leg;            // unit-quantity leg (quantity filled in after solve)
  payoff: Float64Array; // 0/1 payoff over gridStrikes
}

function payoffVector(leg: Leg, strikes: number[]): Float64Array {
  return Float64Array.from(strikes.map((s) => (legPays(leg, s) ? 1 : 0)));
}

/**
 * Dictionary atoms: up & down digitals at every node, disjoint single-cell ranges,
 * plus MACRO contiguous-range atoms (these are the gas win — one leg covers many cells).
 */
export function buildDictionary(strikes: number[], maxMacroWidth = 6): Atom[] {
  const atoms: Atom[] = [];
  const push = (leg: Leg) => atoms.push({ leg: { ...leg, quantity: 1 }, payoff: payoffVector(leg, strikes) });
  for (const k of strikes) {
    push(up(k, 1));
    push(down(k, 1));
  }
  // contiguous range atoms [strikes[i], strikes[j]] up to maxMacroWidth cells wide
  for (let i = 0; i < strikes.length; i += 1) {
    for (let j = i + 1; j < Math.min(strikes.length, i + 1 + maxMacroWidth); j += 1) {
      push(range(strikes[i], strikes[j], 1));
    }
  }
  return atoms.filter((a) => a.payoff.some((v) => v === 1));
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** `git commit -am "feat(solver): digital dictionary with macro range atoms"`.

### Task 1.4: NNOMP outer loop → `solveSparse`

- [ ] **Step 1: Write failing tests** (append)

```ts
import { solveSparse } from './solver';
import type { SparseTarget } from './types';

describe('solveSparse', () => {
  const strikes = [90, 100, 110, 120, 130, 140];

  it('recovers a single range bet exactly with 1 leg', () => {
    // payoff = $1 if 110 < S <= 130 else 0  → exactly one macro range atom
    const g = strikes.map((s) => (s > 110 && s <= 130 ? 1 : 0));
    const target: SparseTarget = { gridStrikes: strikes, g };
    const sol = solveSparse(target, { maxLegs: 8, tol: 1e-6 });
    expect(sol.legCount).toBe(1);
    expect(sol.maxAbsError).toBeLessThan(1e-6);
  });

  it('fits a monotone bull ramp within tolerance under the leg cap', () => {
    const g = strikes.map((s) => Math.max(0, Math.min(3, (s - 100) / 10))); // 0..3 ramp
    const sol = solveSparse({ gridStrikes: strikes, g }, { maxLegs: 8, tol: 0.05 });
    expect(sol.legCount).toBeLessThanOrEqual(8);
    expect(sol.l2Error).toBeLessThanOrEqual(0.05 * Math.sqrt(strikes.length));
    expect(sol.legs.every((l) => l.quantity >= 0)).toBe(true);
  });

  it('respects a hard 3-leg budget even if error stays above tol', () => {
    const g = strikes.map((_, i) => i % 2); // jagged, hard to fit sparsely
    const sol = solveSparse({ gridStrikes: strikes, g }, { maxLegs: 3, tol: 1e-9 });
    expect(sol.legCount).toBeLessThanOrEqual(3);
  });

  it('rejects negative targets (long-only invariant)', () => {
    const g = strikes.map(() => -1);
    expect(() => solveSparse({ gridStrikes: strikes, g }, { maxLegs: 8, tol: 0.01 })).toThrow(/non-negative/i);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`solveSparse` not exported).

- [ ] **Step 3: Implement** in `lib/solver.ts`

```ts
import { USDC, type SparseTarget, type SparseSolution } from './types';

export interface SolveOpts {
  maxLegs: number;        // gas budget B (e.g. 8)
  tol: number;            // weighted L2 error tolerance, USD
  weights?: number[];     // optional per-cell weights (e.g. risk-neutral mass); default uniform
  coefFloor?: number;     // drop dust legs below this qty (default 1e-4 USD)
}

export function solveSparse(target: SparseTarget, opts: SolveOpts): SparseSolution {
  const { gridStrikes: strikes, g } = target;
  if (g.some((v) => v < -1e-9)) throw new Error('target must be non-negative (long-only constraint)');
  const n = strikes.length;
  const w = Float64Array.from(opts.weights ?? new Array(n).fill(1)).map((v) => Math.sqrt(v));
  const coefFloor = opts.coefFloor ?? 1e-4;
  const dict = buildDictionary(strikes);
  const colNorm = dict.map((a) => {
    let s = 0;
    for (let t = 0; t < n; t += 1) s += a.payoff[t] * w[t] * w[t] * a.payoff[t];
    return Math.sqrt(s) || 1;
  });

  const target64 = Float64Array.from(g);
  let residual = Float64Array.from(g);
  let selected: number[] = [];
  let coef: number[] = [];

  for (let leg = 0; leg < opts.maxLegs; leg += 1) {
    // 1. pick atom with max POSITIVE weighted correlation (non-negativity)
    let best = -1;
    let bestC = 1e-12;
    for (let j = 0; j < dict.length; j += 1) {
      if (selected.includes(j)) continue;
      let c = 0;
      for (let t = 0; t < n; t += 1) c += dict[j].payoff[t] * w[t] * w[t] * residual[t];
      c /= colNorm[j];
      if (c > bestC) { bestC = c; best = j; }
    }
    if (best === -1) break;
    selected.push(best);

    // 2. re-solve NNLS over the full support (refines all coefficients)
    const x = nnls(selected.map((j) => dict[j].payoff), target64, w);

    // 3. prune dust legs (collinearity hygiene)
    const keepIdx: number[] = [];
    const keepCoef: number[] = [];
    selected.forEach((j, r) => {
      if (x[r] > coefFloor) { keepIdx.push(j); keepCoef.push(x[r]); }
    });
    selected = keepIdx;
    coef = keepCoef;

    // 4. recompute residual, check tolerance
    residual = Float64Array.from(g);
    selected.forEach((j, r) => {
      for (let t = 0; t < n; t += 1) residual[t] -= coef[r] * dict[j].payoff[t];
    });
    let err = 0;
    for (let t = 0; t < n; t += 1) err += (residual[t] * w[t]) ** 2;
    if (Math.sqrt(err) <= opts.tol) break;
  }

  // assemble legs with integer USDC quantities; compute error metrics
  const legs: Leg[] = selected.map((j, r) => ({ ...dict[j].leg, quantity: Math.round(coef[r] * USDC) }));
  let l2 = 0;
  let maxAbs = 0;
  for (let t = 0; t < n; t += 1) {
    l2 += (residual[t] * w[t]) ** 2;
    maxAbs = Math.max(maxAbs, Math.abs(residual[t]));
  }
  return {
    legs,
    l2Error: Math.sqrt(l2),
    maxAbsError: maxAbs,
    premiumEst: 0, // filled by priceSolution (Task 1.5)
    legCount: legs.length,
  };
}
```

- [ ] **Step 4: Run — PASS** (all 4 tests). **Step 5: Commit** `git commit -am "feat(solver): NNOMP gas-bounded sparse replication"`.

### Task 1.5: Price the solution off SVI + wire into the optimizer

- [ ] **Step 1: Write failing test** (append)

```ts
import { priceSolution } from './solver';
import type { SVI } from './types';

describe('priceSolution', () => {
  it('prices a solution as sum of leg probabilities * quantity', () => {
    const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };
    const sol = solveSparse({ gridStrikes: [90, 100, 110, 120], g: [0, 0, 1, 1] }, { maxLegs: 4, tol: 1e-6 });
    const priced = priceSolution(sol, svi, 100_000); // forward ~ $100k BTC
    expect(priced.premiumEst).toBeGreaterThan(0);
    // premium of a defined-risk long can never exceed max payout
    expect(priced.premiumEst).toBeLessThanOrEqual(1 * 1); // $1 max payout per the unit range
  });
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** in `lib/solver.ts`

```ts
import { legProb } from './payoff';
import type { SVI } from './types';

export function priceSolution(sol: SparseSolution, svi: SVI, forward: number): SparseSolution {
  const premiumEst = sol.legs.reduce(
    (sum, leg) => sum + legProb(svi, forward, leg) * (leg.quantity / USDC),
    0,
  );
  return { ...sol, premiumEst };
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** `git commit -am "feat(solver): SVI pricing of sparse solutions"`.

- [ ] **Step 6: Extend `optimizer.ts`** so the freeform/draw path produces N candidate decompositions (range-basis exact, NNOMP at `maxLegs ∈ {4,6,8}`) and picks the cheapest priced one — this is the "same payoff, 3 ways" feature.

```ts
// in lib/optimizer.ts — add:
import { solveSparse, priceSolution } from './solver';
import type { SparseTarget, SVI } from './types';

export function optimizeSparse(target: SparseTarget, svi: SVI, forward: number) {
  const candidates = [4, 6, 8].map((maxLegs) =>
    priceSolution(solveSparse(target, { maxLegs, tol: 0.005 }), svi, forward),
  );
  candidates.sort((a, b) => a.premiumEst - b.premiumEst || a.legCount - b.legCount);
  return { best: candidates[0], all: candidates };
}
```

- [ ] **Step 7: Add test** `optimizer.test.ts` asserting `optimizeSparse` returns a `best` whose `legCount <= 8`, then **commit** `git commit -am "feat(optimizer): cost-optimal sparse decomposition across leg budgets"`.

**Phase 1 gate:** `pnpm vitest run` green; `solver.ts` provides exact recovery, bounded-error sparse fit under a hard leg cap, non-negativity enforcement, and SVI pricing.

---

## PHASE 2 — Structured Vault (Move): tokenized shares, NAV, deposit queue, HWM fees

**Goal:** a `StructuredVault<Quote>` that owns a `PredictManager`, runs a strategy, and issues fungible `Coin<STUDIO_LP>` shares priced off marked NAV — the spine (C1) that makes everything composable. Uses virtual-shares + internal-accounted-balance to kill the donation attack (C2 of accounting).

**Files:** Create `move/sources/vault.move`, `move/tests/vault_tests.move`. Test runner: `cd move && sui move test`.

### Task 2.1: Vault object + share token via TreasuryCap

- [ ] **Step 1: Write the failing test** in `move/tests/vault_tests.move`

```move
#[test_only]
module predict_studio::vault_tests {
    use predict_studio::vault;
    use sui::test_scenario as ts;
    use sui::coin;

    #[test]
    fun first_deposit_mints_shares_and_sets_accounted_balance() {
        let admin = @0xA;
        let mut sc = ts::begin(admin);
        let ctx = ts::ctx(&mut sc);
        let mut v = vault::new_for_testing(ctx);           // empty vault, virtual offset baked in
        let dep = coin::mint_for_testing<vault::DUSDC_T>(1_000_000, ctx); // $1
        let shares = vault::deposit(&mut v, dep, ctx);
        // first deposit: shares ~= assets * 10^offset / 1  (minus dead shares)
        assert!(coin::value(&shares) > 0, 0);
        assert!(vault::accounted_assets(&v) == 1_000_000, 1);
        coin::burn_for_testing(shares);
        vault::destroy_for_testing(v);
        ts::end(sc);
    }
}
```

- [ ] **Step 2: Run — FAIL.** Run: `cd move && sui move test` — module `vault` not found.

- [ ] **Step 3: Implement minimal `vault.move`** (share accounting only; strategy legs added in 2.3)

```move
module predict_studio::vault {
    use std::string::String;
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin, TreasuryCap};

    /// Decimal offset for virtual shares (donation-attack mitigation). 10^6 virtual shares.
    const SHARE_OFFSET: u128 = 1_000_000;
    const DEAD_SHARES: u64 = 1_000;

    const ENotManager: u64 = 1;
    const EBelowMinDeposit: u64 = 2;
    const EZeroShares: u64 = 3;

    /// Placeholder quote type for tests; real vault is generic over the dUSDC Quote type.
    public struct DUSDC_T has drop {}
    /// The fungible vault-share witness.
    public struct STUDIO_LP has drop {}

    public struct StructuredVault<phantom Quote> has key, store {
        id: UID,
        manager_owner: address,
        idle: Balance<Quote>,        // accounted cash; NAV cash component
        accounted_assets: u64,       // internal accounting — NOT balance::value (kills donations)
        share_treasury: TreasuryCap<STUDIO_LP>,
        total_shares: u64,
        hwm_pps_num: u128,           // high-water-mark price-per-share (scaled)
        min_deposit: u64,
        strategy: String,
    }

    public fun accounted_assets<Q>(v: &StructuredVault<Q>): u64 { v.accounted_assets }
    public fun total_shares<Q>(v: &StructuredVault<Q>): u64 { v.total_shares }

    /// shares = floor( assets * (total_shares + OFFSET) / (accounted_assets + 1) )
    fun to_shares<Q>(v: &StructuredVault<Q>, assets: u64): u64 {
        let num = (assets as u128) * ((v.total_shares as u128) + SHARE_OFFSET);
        let den = (v.accounted_assets as u128) + 1;
        (num / den) as u64
    }

    /// assets = floor( shares * (accounted_assets + 1) / (total_shares + OFFSET) )
    fun to_assets<Q>(v: &StructuredVault<Q>, shares: u64): u64 {
        let num = (shares as u128) * ((v.accounted_assets as u128) + 1);
        let den = (v.total_shares as u128) + SHARE_OFFSET;
        (num / den) as u64
    }

    public fun deposit<Q>(v: &mut StructuredVault<Q>, c: Coin<Q>, ctx: &mut TxContext): Coin<STUDIO_LP> {
        let amt = coin::value(&c);
        assert!(amt >= v.min_deposit, EBelowMinDeposit);
        let mut minted = to_shares(v, amt);
        // first real deposit: lock DEAD_SHARES to a burn (mint then never track for redemption)
        if (v.total_shares == 0) {
            assert!(minted > DEAD_SHARES, EZeroShares);
            minted = minted - DEAD_SHARES;
            v.total_shares = v.total_shares + DEAD_SHARES;
        };
        assert!(minted > 0, EZeroShares);
        balance::join(&mut v.idle, coin::into_balance(c));
        v.accounted_assets = v.accounted_assets + amt;
        v.total_shares = v.total_shares + minted;
        coin::mint(&mut v.share_treasury, minted, ctx)
    }

    public fun withdraw<Q>(v: &mut StructuredVault<Q>, s: Coin<STUDIO_LP>, ctx: &mut TxContext): Coin<Q> {
        let shares = coin::value(&s);
        let assets = to_assets(v, shares);
        coin::burn(&mut v.share_treasury, s);
        v.total_shares = v.total_shares - shares;
        v.accounted_assets = v.accounted_assets - assets;
        coin::take(&mut v.idle, assets, ctx)
    }

    #[test_only]
    public fun new_for_testing(ctx: &mut TxContext): StructuredVault<DUSDC_T> {
        let cap = coin::create_treasury_cap_for_testing<STUDIO_LP>(ctx);
        StructuredVault {
            id: object::new(ctx),
            manager_owner: tx_context::sender(ctx),
            idle: balance::zero<DUSDC_T>(),
            accounted_assets: 0,
            share_treasury: cap,
            total_shares: 0,
            hwm_pps_num: 0,
            min_deposit: 1,
            strategy: b"test".to_string(),
        }
    }

    #[test_only]
    public fun destroy_for_testing<Q>(v: StructuredVault<Q>) {
        let StructuredVault { id, manager_owner: _, idle, accounted_assets: _, share_treasury,
            total_shares: _, hwm_pps_num: _, min_deposit: _, strategy: _ } = v;
        balance::destroy_for_testing(idle);
        // share_treasury and id consumed/deleted
        sui::test_utils::destroy(share_treasury);
        object::delete(id);
    }
}
```

- [ ] **Step 4: Run — PASS.** Run: `cd move && sui move test`. **Step 5: Commit** `git commit -am "feat(vault): StructuredVault shares with virtual-offset accounting"`.

### Task 2.2: Donation-attack resistance test

- [ ] **Step 1: Write failing test** (append to `vault_tests.move`)

```move
#[test]
fun donation_does_not_move_share_price() {
    let admin = @0xA;
    let mut sc = ts::begin(admin);
    let ctx = ts::ctx(&mut sc);
    let mut v = vault::new_for_testing(ctx);
    // victim deposits $1
    let s1 = vault::deposit(&mut v, coin::mint_for_testing<vault::DUSDC_T>(1_000_000, ctx), ctx);
    // attacker DONATES $1000 straight into idle balance (not via deposit)
    vault::donate_for_testing(&mut v, coin::mint_for_testing<vault::DUSDC_T>(1_000_000_000, ctx));
    // a second depositor of $1 still gets ~ the same shares as victim (accounted_assets unchanged by donation)
    let s2 = vault::deposit(&mut v, coin::mint_for_testing<vault::DUSDC_T>(1_000_000, ctx), ctx);
    let v1 = coin::value(&s1);
    let v2 = coin::value(&s2);
    // within 1% — donation did NOT inflate PPS because accounting ignores untracked balance
    assert!(v2 * 100 >= v1 * 99, 0);
    coin::burn_for_testing(s1); coin::burn_for_testing(s2);
    vault::destroy_for_testing(v);
    ts::end(sc);
}
```

- [ ] **Step 2: Run — FAIL** (`donate_for_testing` missing).
- [ ] **Step 3: Add** to `vault.move`:

```move
#[test_only]
public fun donate_for_testing<Q>(v: &mut StructuredVault<Q>, c: Coin<Q>) {
    balance::join(&mut v.idle, coin::into_balance(c)); // joins balance but NOT accounted_assets
}
```

- [ ] **Step 4: Run — PASS** (proves internal accounting defeats donations). **Step 5: Commit** `git commit -am "test(vault): donation attack neutralized by internal accounting"`.

### Task 2.3: Strategy minting (vault buys a structured position) + NAV mark

Wire the vault to mint legs through `studio::build_and_mint` into its owned `PredictManager`, then mark NAV = idle + Σ legProb·qty. **VERIFY-FIRST:** confirm the `PredictManager` the vault owns can be borrowed `&mut` alongside the vault in one PTB; confirm `manager.balance<Quote>()` reflects post-mint cash.

- [ ] **Step 1: Write failing test** (`vault_tests.move`) asserting that after `roll_into_strategy` with a mocked oracle, `nav()` ≈ idle − premium + markedPositionValue, and shares are unchanged (minting doesn't dilute). *(Use a Predict test harness or a thin mock of `OracleSVI` — see `studio_tests.move` pattern.)*
- [ ] **Step 2–4:** Implement `roll_into_strategy<Quote>(&mut StructuredVault, &mut Predict, &OracleSVI, legs, budget, &Clock, ctx)` that calls `studio::build_and_mint`, stores the returned `StructuredPosition` inside the vault (add field `open: Option<StructuredPosition>`), and `nav<Quote>(&StructuredVault, &OracleSVI): u64` computing marked value. Round-trip test passes.
- [ ] **Step 5: Commit** `git commit -am "feat(vault): strategy minting + SVI-marked NAV"`.

### Task 2.4: Round-based deposit queue (Ribbon pattern — no mid-epoch dilution)

Deposits made while a position is open go to a `pending: Balance<Quote>` bucket and mint shares only at the next roll (`process_pending`), so in-flight P&L isn't shared with new capital. Critical for ~hourly cadence.

- [ ] **Step 1:** Test: deposit during open epoch returns a `PendingReceipt` (not shares); after `settle` + `process_pending`, the receipt is claimable for shares at the *new* PPS.
- [ ] **Step 2–4:** Implement `pending`, `PendingReceipt { epoch, assets }`, `request_deposit`, `process_pending`, `claim`. Tests pass.
- [ ] **Step 5: Commit** `git commit -am "feat(vault): round-based pending deposit queue"`.

### Task 2.5: High-water-mark performance fee (fee via share dilution)

- [ ] **Step 1:** Test: after a profitable settle that lifts PPS above `hwm`, `crystallize_fee` mints `feeShares` to the manager such that post-fee PPS = `(assets − fee)/(supply + feeShares)`, and `hwm` ratchets up; a second crystallize at the same PPS mints zero.
- [ ] **Step 2–4:** Implement per the research formula: `feeAssets = perfRate · (currentPPS − hwm) · totalSupply`; `feeShares = feeAssets · totalSupply / (assets − feeAssets)`; `hwm` only ratchets up. `perfRate` stored as bps. Tests pass.
- [ ] **Step 5: Commit** `git commit -am "feat(vault): high-water-mark performance fee"`.

### Task 2.6: KeeperCap (bounded, permissionless-friendly automation)

Brahma-style scoped capability so a keeper can only call `settle`+`process_pending`+`roll_into_strategy` within configured bands/size — automation without custody, and re-grantable so the crank is decentralizable (Friktion's centralized crank was fatal).

- [ ] **Step 1:** Test: a `KeeperCap` holder can call `keeper_roll`; a non-holder aborts `ENotKeeper`; the cap cannot call `withdraw` (no entry exists).
- [ ] **Step 2–4:** Implement `KeeperCap { vault_id, max_budget, ... }`, `grant_keeper` (manager-only), `keeper_roll`. Tests pass.
- [ ] **Step 5: Commit** `git commit -am "feat(vault): scoped KeeperCap automation"`.

**Phase 2 gate:** `cd move && sui move test` green across `vault_tests`; NAV, deposit queue, HWM fee, donation-resistance, and keeper scoping all proven.

---

## PHASE 3 — Decentralized Keeper Service (TS)

**Goal:** an off-chain loop anyone can run that settles expired epochs, reselects the next range bands off the SVI surface by target probability, processes pending deposits, and re-enters — all through `KeeperCap`-gated calls. Permissionless: ships as a script + a public bounty so it can't single-point-fail.

**Files:** `keeper/roll.ts`, `keeper/config.example.json`, `lib/vault-client.ts`.

- [ ] **Task 3.1:** `vault-client.ts` — `buildDepositTx`, `buildWithdrawTx`, `buildKeeperRollTx`, `readNav` (devInspect). TDD against a local mock of the PTB builder (unit-test the PTB shape; live calls are Phase 5 gated). Commit.
- [ ] **Task 3.2:** `roll.ts` — poll oracle `expiry`/`is_settled`; when settled, build settle→reselect→re-enter PTB; band reselection picks strikes whose `priceUp` ≈ configured target deltas (e.g. 25Δ/50Δ). Dry-run mode prints the PTB without signing. Commit.
- [ ] **Task 3.3:** Strike-reselection unit test: given an SVI surface and target deltas, asserts the chosen strikes bracket the forward correctly and respect `min_ask`/`max_ask` bounds. Commit.

**Gate:** keeper runs in dry-run against fixtures; live run deferred to Phase 5 (tokens).

---

## PHASE 4 — PT/YT Tranching (Pendle-style) — novel on Sui

**Goal:** split a `Coin<STUDIO_LP>` share into `Coin<PT>` (fixed coupon, redeem 1:1 of the floor at epoch end) + `Coin<YT>` (the variable/upside band). Lets one vault serve fixed-income and degen demand from the same pool. Invariant: `PT + YT = share`.

**Files:** `move/sources/pt_yt.move`, `move/tests/pt_yt_tests.move`, `lib/tranche-client.ts`.

- [ ] **Task 4.1:** Test `split` mints equal `PT`+`YT` against a deposited share and `merge` reverses it exactly (conservation). Implement `split`/`merge` with two `TreasuryCap`s held by a `TrancheVault`. Commit.
- [ ] **Task 4.2:** Test redemption at maturity: after `oracle.is_settled()`, `PT` redeems the protected floor first, `YT` redeems the residual; sum equals total payout (no value leak). Implement. Commit.
- [ ] **Task 4.3:** `tranche-client.ts` split/merge/redeem PTBs + unit tests on PTB shape. Commit.

**Gate:** `sui move test` green; `PT+YT` conservation and maturity waterfall proven.

---

## PHASE 5 — Composability Mesh (integration; VERIFY-FIRST each)

Ranked by (ambition × feasibility × real-world × buildability). Each is independent; do as many as time allows. Every task starts by confirming the live API against testnet before writing the call.

- [ ] **5a — Enoki zkLogin + sponsored gas (highest real-world ROI).** `lib/enoki.ts` + `MintButton` sponsored path + `providers.tsx` `EnokiFlowProvider`. Google login → self-custodial address; Enoki sponsors the mint PTB so a retail user buys a note with **zero SUI, no gas prompt**. VERIFY-FIRST: Enoki testnet app-id, sponsored-tx allowlist for our package. Demo: "sign in with Google, buy a capped-risk BTC note in two clicks." Commit.
- [ ] **5b — Pyth NAV + settlement anchor.** `lib/pyth.ts`: pull BTC price, refresh in the mint PTB preamble; use the same feed for frontend NAV mark-to-market. VERIFY-FIRST: Pyth Sui testnet `PriceInfoObject` id for BTC/USD; whether Predict's `OracleSVI` already consumes it (then we only mirror for display). Commit.
- [ ] **5c — Cetus secondary market for shares.** `lib/cetus.ts`: create a `STUDIO_LP/dUSDC` CLMM pool; quote the secondary price so depositors can **exit before expiry** (the thing Friktion lacked). VERIFY-FIRST: Cetus testnet SDK `createPool` with a custom coin type. `VaultMarket.tsx` shows NAV vs secondary price. Commit.
- [ ] **5d — Walrus self-describing notes.** `lib/walrus.ts`: store the payoff-spec JSON + backtest artifact as a blob; put `{blobId, hash}` on the vault/position object. Frontend renders the payoff diagram from the blob. VERIFY-FIRST: Walrus testnet/mainnet publisher endpoint. Commit.
- [ ] **5e — Suilend-style defined-risk-as-collateral (most novel thesis).** `move/sources/studio_collateral.move`: a minimal **isolated** lending market that accepts `Coin<STUDIO_LP>` as collateral (LTV bounded by the share's *known* max-loss floor) and lends `dUSDC`. We deploy our *own* market on testnet (do **not** claim a mainnet Suilend listing — that needs governance). Story: "bounded-loss notes are ideal collateral." VERIFY-FIRST: keep it self-contained; reuse OZ-style health-factor math. Commit.

**Cut deliberately (research-justified):** Bluefin, Supra, Switchboard (no marginal story over Pyth), Seal (Move can't decrypt — thin IP-hiding only), closed-loop Token (conflicts with the `Coin` composability spine). DeepBook flash-loan hedged minting + Kiosk royalty notes = stretch only.

---

## PHASE 6 — Product Catalog + UX

**Goal:** ship the 12 retail-legible structured products (Cega FCN framing: headline coupon + barrier, not Greeks), the draw-any-payoff builder backed by the NNOMP solver, a vault marketplace, tranche panel, and a backtester.

**Files:** `lib/catalog.ts`, `app/components/{CatalogPicker,VaultMarket,TranchePanel,SolverInspector}.tsx`, extend `Builder.tsx`/`Backtester.tsx`, `scripts/seed-vaults.ts`.

- [ ] **Task 6.1:** `catalog.ts` — 12 products as `(params) → TargetPayoff` (Capped Bull/Bear Note, Digital Call/Put, Iron Condor Income, Twin-Win, Shark-Fin, Fixed-Coupon Range Note, Digital Ladder, Barrier Box, Butterfly Pin, Dual-Range Barbell). TDD: each returns a non-negative `g` and round-trips through `solveSparse` to ≤8 legs. Commit.
- [ ] **Task 6.2:** `CatalogPicker.tsx` + `SolverInspector.tsx` — pick a product, see its payoff chart + "same payoff, 3 ways" cost table from `optimizeSparse`. Commit.
- [ ] **Task 6.3:** `Builder.tsx` draw-any-payoff canvas → `SparseTarget` → solver → mint PTB. Commit.
- [ ] **Task 6.4:** `VaultMarket.tsx` (browse/deposit/withdraw, live NAV/APR, secondary price) + `TranchePanel.tsx` (buy PT/YT). Commit.
- [ ] **Task 6.5:** `Backtester.tsx` per-product historical replay using stored SVI snapshots; show realized vs modeled payoff. `seed-vaults.ts` creates demo vaults. Commit.

**Gate:** `next build` clean; `pnpm vitest run` green; every catalog product mints to ≤8 legs.

---

## PHASE 7 — Demo, Docs, Submission

- [ ] **Task 7.1:** `scripts/gas-benchmark.ts` live run (TOKEN-GATED) — confirm legs-per-PTB vs the 5M compute cap; record the safe leg budget; set solver `maxLegs` accordingly.
- [ ] **Task 7.2:** Live end-to-end on testnet (TOKEN-GATED): deploy all packages, create a vault, sponsored-gas deposit via Enoki, roll into an Iron Condor, settle, redeem; capture tx digests.
- [ ] **Task 7.3:** `README.md` + `docs/DEMO.md` — the six pillars, the load-bearing constraints, the integration matrix, tx digests, and a 3-minute demo script. Submit to DeepSurge before **June 21, 2026 Pacific**.

---

## Integration & Feature Matrix (research-grounded)

| Source protocol | Borrowed mechanic | Where it lands |
|---|---|---|
| Carr–Madan / Breeden–Litzenberger | Static replication from digitals | P1 engine (core IP) |
| (novel) | NNOMP gas-bounded sparse replication | P1 `solver.ts` ★ |
| Ribbon / Aevo | Round-based deposit queue; auto-roll keeper | P2.4, P3 |
| Friktion (failure lesson) | Decentralized crank, not centralized | P2.6, P3 |
| Cega | FCN framing: headline coupon + barrier | P6 catalog |
| Pendle | PT/YT tranching of the vault share | P4 |
| Thetanuts | Tokenized share as composable collateral; multi-band index | P5e, P6 |
| Enzyme / Brahma | Vault share/NAV/policy + scoped keeper cap | P2, P2.6 |
| OpenZeppelin ERC-4626 | Virtual-shares + internal accounting (donation defense) | P2.1–2.2 |
| Azuro / Overtime / Drift | LP accounting, tranches, insurance-fund *(reference only — Predict owns the LP/PLP side)* | flagged out |
| Hyperliquid | Builder codes (fee attribution to strategists/UIs) | P6 stretch |
| Sui: TreasuryCap/PTB/Pyth/Enoki/Cetus/Walrus/Suilend | The composability mesh | P2, P5 |

## What's permanently out of scope (long-only wall, C2)
Covered-call / cash-secured-put premium-selling vaults; Lyra/Derive delta-hedged MMVs; Synthetix pooled-debt; HLP/Drift/GMX funding capture; true short straddles/strangles; Squeeth power-perpetuals (only the long-convexity half is approximable via a dense long-range strip). Our vault is always the buyer; the short side is DeepBook Predict's SVI book.

## Judging alignment (~50% real-world / 20% product / 20% technical / 10% presentation)
- **Real-world (50%):** Enoki gasless retail onboarding (grandma buys a capped-risk note via Google login); FCN coupon+barrier framing; tradeable/collateralizable notes; a full structured-products category that doesn't exist on Sui.
- **Technical (20%):** the NNOMP gas-bounded sparse solver; on-chain max-loss envelope; virtual-share donation-proof vault; PT/YT conservation invariant.
- **Product (20%):** draw-any-payoff builder + "same payoff, 3 ways" optimizer + vault marketplace.
- **Presentation (10%):** self-describing Walrus notes; live testnet tx digests; clean 3-minute demo.

## Risks & cut-lines (build in-to-out; each phase ships alone)
1. **Token delay** blocks all live steps (P7, P5 live calls) — mitigated: P1–P4 + P6 UI are fully offline/testnet-mockable.
2. **Gas cap** may force `maxLegs` < 8 — P1 solver already parameterizes the budget; P7.1 sets it from the live benchmark.
3. **Integration sprawl** — P5 is à la carte; ship 5a+5b first (highest ROI), others if time.
4. **PredictManager ownership semantics** (VERIFY-FIRST in P2.3) — if a vault-owned manager can't be `&mut`-shared in a PTB, fall back to a thin escrow object holding the manager.

---

---

# PART II — DEEPENED KERNELS & EXPANDED SCOPE

Part I is a complete, shippable protocol. Part II is what turns it from "solid hackathon build" into research-grade depth + a wider, *coherent* surface. Three deepened engine kernels (1A/1B/1C) replace the naive solver/optimizer with the correct math; three new pillars (8 RFQ execution, 9 creator economy, 10 cross-margin portfolio) extend scope along the grain of the core. Everything here is grounded in the cross-protocol research and the vendored-source pricing facts in §0.

**Revised pillar map:** P1(engine: 1A arb-free guard → 1B impact-aware optimizer → 1C MILP solver) → P2(core, built) → P3(vault) → {P4 tranche, P5 mesh} → **P8(RFQ) → P9(creator economy) → P10(portfolio)** → P6(UX) → P7(demo).

---

## PHASE 1A — Arbitrage-Free SVI Guard & Risk-Neutral-Density Repair (offline)

**Why it's load-bearing, not optional:** every range/digital price is `P · (CDF mass)` off the SVI surface. If the live slice has a **butterfly-arbitrage** violation, the implied density goes *negative* and the pricer emits **negative range prices** → the solver, NAV, and premium all corrupt silently. This kernel detects and repairs it so digital prices stay in `[0,1]` and monotone in strike. (Gatheral–Jacquier 2014; Martini–Mingone 2020.)

**Files:** Create `lib/arbfree.ts`, `lib/arbfree.test.ts`. Modify `lib/payoff.ts` to route `priceUp`/`priceRange` through the guarded density when a violation is detected.

### Task 1A.1: SVI derivatives + the `g(k)` butterfly function

- [ ] **Step 1: Write failing test** in `lib/arbfree.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sviW, sviDerivs, gFunction } from './arbfree';
import type { SVI } from './types';

describe('svi arb-free primitives', () => {
  const svi: SVI = { a: 0.04, b: 0.1, rho: -0.3, m: 0, sigma: 0.2 };
  it('computes w, w prime, w double-prime analytically (no finite diff)', () => {
    const { w, wp, wpp } = sviDerivs(svi, 0.1);
    expect(w).toBeCloseTo(sviW(svi, 0.1), 12);
    expect(wpp).toBeGreaterThan(0); // strictly convex for sigma>0
  });
  it('g(k) is positive for a well-behaved slice', () => {
    for (let k = -1; k <= 1; k += 0.1) expect(gFunction(svi, k)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** in `lib/arbfree.ts`

```ts
import type { SVI } from './types';

export function sviW(svi: SVI, k: number): number {
  const u = k - svi.m;
  return svi.a + svi.b * (svi.rho * u + Math.sqrt(u * u + svi.sigma * svi.sigma));
}

/** Analytic w, w', w'' (do NOT finite-difference — closed form per research). */
export function sviDerivs(svi: SVI, k: number): { w: number; wp: number; wpp: number } {
  const u = k - svi.m;
  const R = Math.sqrt(u * u + svi.sigma * svi.sigma);
  const w = svi.a + svi.b * (svi.rho * u + R);
  const wp = svi.b * (svi.rho + u / R);
  const wpp = (svi.b * svi.sigma * svi.sigma) / (R * R * R);
  return { w, wp, wpp };
}

/** Durrleman density-positivity function: g(k) >= 0 everywhere  <=>  no butterfly arb. */
export function gFunction(svi: SVI, k: number): number {
  const { w, wp, wpp } = sviDerivs(svi, k);
  const t1 = (1 - (k * wp) / (2 * w)) ** 2;
  const t2 = ((wp * wp) / 4) * (1 / w + 0.25);
  return t1 - t2 + wpp / 2;
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** `git commit -am "feat(arbfree): SVI analytic derivatives + Durrleman g(k)"`.

### Task 1A.2: Violation detection (grid + parameter pre-screen)

- [ ] **Step 1: Test** that `detectButterflyViolation` returns `ok:false` for a hand-crafted arb slice (large `b`, `|rho|→1`) and `ok:true` for the benign one; asserts `b·(1+|rho|)·T ≤ 4` pre-screen fires.
- [ ] **Step 2–4: Implement** `detectButterflyViolation(svi, T, {kLo,kHi,dk})` per research §1.5: parameter pre-screen `b(1+|ρ|)T ≤ 4`, then scan `g(k)` on a fine grid (`dk≈0.005`), bracket sign changes, return `{ok, minG, badIntervals}`.
- [ ] **Step 5: Commit** `git commit -am "feat(arbfree): butterfly-violation detector"`.

### Task 1A.3: Density repair → guaranteed monotone digitals

- [ ] **Step 1: Test:** for an arb slice, `repairedDigitals(svi,T,grid)` returns an up-digital curve that is (a) in `[0,1]`, (b) non-increasing in strike; range prices `≥ 0`.
- [ ] **Step 2–4: Implement** Layer B (model-free) per research §1.6: sample `p(k)=g(k)/√(2πw)·exp(−d₋²/2)`, clamp `max(p,0)`, renormalize to unit mass, build monotone CDF, price digitals from the survival function. Assert the boundary invariants.
- [ ] **Step 5:** Route `payoff.ts` `priceUp`/`priceRange` to use repaired density **only when** `detectButterflyViolation` flags the slice (benign slices keep the fast closed form). **Commit** `git commit -am "feat(arbfree): density repair guarantees monotone non-negative digitals"`.

**Phase 1A gate:** pricer provably never emits a negative range price or a non-monotone digital curve, even on a degenerate live surface.

---

## PHASE 1B — Impact-Aware Sequential Optimizer (offline; grounded in §0 spread formula)

**The naive optimizer is wrong and now we can prove it.** `get_trade_amounts` quotes a leg against *current* state; minting it raises `total_mtm`, so the next leg's `utilization_spread = base_spread · util_mult · (mtm/balance)²` rises. Pricing legs independently underprices every multi-leg basket — exactly our flagship product. This phase models the real cost and optimizes leg **ordering** and **splitting**.

**Files:** Create `lib/impact.ts`, `lib/impact.test.ts`. Modify `lib/optimizer.ts` to expose `optimizeBasket` (sequential).

### Task 1B.1: Local replica of the on-chain spread/cost model

- [ ] **Step 1: Test** `legCost` reproduces the §0 formula: given `fairPrice`, `mtm`, `balance`, `params{baseSpread,minSpread,utilMult,minAsk,maxAsk}`, the ask = `fair + max(baseSpread·√(p(1−p)), minSpread) + baseSpread·utilMult·(mtm/balance)²`, clamped, and cost = `ask·qty`. Assert a larger `mtm` strictly raises cost.

```ts
import { legCost, type ImpactParams } from './impact';
it('utilization term makes a leg strictly more expensive as mtm rises', () => {
  const p: ImpactParams = { baseSpread: 0.02, minSpread: 0.005, utilMult: 1.5, minAsk: 0.01, maxAsk: 0.99 };
  const lo = legCost(0.5, 1_000, 10_000, 1, p);
  const hi = legCost(0.5, 6_000, 10_000, 1, p);
  expect(hi).toBeGreaterThan(lo);
});
```

- [ ] **Step 2–4: Implement** `legCost(fairPrice, mtm, balance, qty, params)` and an `AmmState { mtm, balance }` with `applyMint(state, leg, fairPrice) → state'` that raises `mtm` by the leg's marked exposure (`fairPrice·qty` as the first-order proxy; refine with `max_payout` semantics in 1B.3). 
- [ ] **Step 5: Commit** `git commit -am "feat(impact): on-chain spread/cost replica"`.

### Task 1B.2: Sequential basket pricing (naive-vs-correct)

- [ ] **Step 1: Test** `priceBasketSequential(legs, state, fairOf)` ≥ `priceBasketNaive(...)` for a same-oracle multi-leg basket, with strict `>` once `utilMult>0`; equal when `utilMult=0`.
- [ ] **Step 2–4: Implement** both: naive prices every leg at `state₀`; sequential threads `applyMint` between legs. Return `{naive, sequential, impactCost = sequential − naive}`.
- [ ] **Step 5: Commit** `git commit -am "feat(impact): sequential vs naive basket pricing"`.

### Task 1B.3: Optimal leg ordering (exact DP for n≤12) + greedy fallback

- [ ] **Step 1: Test** that `optimalOrder(legs, state, fairOf)` returns a permutation whose total sequential cost is ≤ the identity order's, and equals the brute-force min for n≤6 (enumerate permutations in the test).
- [ ] **Step 2–4: Implement** Held–Karp DP over leg subsets (research §2.5): `DP[subset] = min cost to mint that subset`, transition prices the added leg against the state implied by `subset`; reconstruct the optimal order. Greedy-with-1-step-lookahead for `n>12`.
- [ ] **Step 5: Commit** `git commit -am "feat(impact): exact DP optimal leg ordering"`.

### Task 1B.4: Large-leg splitting across strikes (convex QP)

- [ ] **Step 1: Test** that splitting one large leg into child orders across adjacent strikes lowers total cost vs a single mint when `utilMult>0`, and that children sum to the parent quantity.
- [ ] **Step 2–4: Implement** the projected-gradient solve of `min Σ(½·η·qk² + impact)` s.t. `Σqk=Q, qk≥0` (research §2.4), using `legCost` as the per-child evaluator. Respect the 80% exposure cap as a hard constraint (reject/scale if `mtm` would breach `0.8·balance`).
- [ ] **Step 5:** Wire `optimizer.ts` `optimizeBasket(legs, svi, forward, state)` = arb-guard (1A) → order (1B.3) → split (1B.4) → return `{order, totalCost, impactCost, exposureOk}`. **Commit** `git commit -am "feat(optimizer): impact-aware basket optimization"`.

**Phase 1B gate:** the cost optimizer prices baskets the way the chain actually charges; ordering + splitting demonstrably reduce premium and respect the exposure cap.

---

## PHASE 1C — MILP Exact Sparse Replication + Suboptimality Certificate (offline)

**Why:** NNOMP (Phase 1) is greedy and can be 1+ legs off optimal. With a hard gas budget `B≤8`, leg count is *money* — an extra leg is real premium + gas. This phase certifies (and when needed, achieves) the exact minimum-leg replication, with a provable gap bound vs the greedy solution.

**Files:** Modify `lib/solver.ts` (+ `solver.test.ts`).

### Task 1C.1: Exhaustive-support exact solver for small dictionaries

- [ ] **Step 1: Test** that `solveExact(target, {maxLegs:B})` finds a `legCount ≤ B` solution with `l2Error` ≤ the NNOMP solution's error on a target where greedy is known to be suboptimal (construct a 3-atom collinear trap).
- [ ] **Step 2–4: Implement** support enumeration: for all supports of size `≤ B` over the (incoherence-pruned) dictionary when `Σ C(M,b)` is small, run `nnls` on each, keep the min-error/min-leg solution. Prune near-duplicate atoms by coherence `μ_{ij}>τ`.
- [ ] **Step 5: Commit** `git commit -am "feat(solver): exact exhaustive-support sparse solve"`.

### Task 1C.2: Branch-and-bound with NNOMP warm-start (larger dictionaries)

- [ ] **Step 1: Test** B&B returns the same objective as exhaustive on a mid-size case, and never worse than NNOMP.
- [ ] **Step 2–4: Implement** the research §3.4 B&B: NNLS-relaxation lower bound per node, branch on the largest undecided atom, prune by bound, warm-start incumbent from `solveSparse` (NNOMP). Big-M tightened via `max wⱼ` LP.
- [ ] **Step 5: Commit** `git commit -am "feat(solver): branch-and-bound exact MILP solve"`.

### Task 1C.3: Suboptimality certificate on the greedy path

- [ ] **Step 1: Test** `certifyGap(target, B)` returns `{coherence μ, exactRecovery: μ < 1/(2B−1), gapBound}` and that when `exactRecovery` is true, NNOMP error == exact error.
- [ ] **Step 2–4: Implement** mutual-coherence computation over the active dictionary and the research §3.5 bounds; expose `escalate` flag (true ⇒ caller should run 1C.2). `optimizeSparse` uses NNOMP, then escalates to exact only when the certificate fails or `B≤8` and high stakes.
- [ ] **Step 5: Commit** `git commit -am "feat(solver): coherence-based suboptimality certificate"`.

**Phase 1C gate:** for any structure, the engine either certifies NNOMP is optimal or returns the exact minimum-leg basket — the "fewest legs, provably" guarantee.

---

## PHASE 8 — RFQ Signed-Quote Execution Layer (the answer to self-impact)

**Why it's coherent, not bolt-on:** Phase 1B proves large baskets self-impact the SVI book. The fix the whole derivatives industry uses (Paradigm blocks, Hashflow signed quotes, Ribbon batch auctions) is **RFQ**: a market maker prices the *whole structure at once* off-chain and signs it; our contract verifies the signature and mints atomically. The maker takes the short side **on Predict** — our protocol still never shorts (C2 preserved). This gives whales an all-in price with **zero slippage** and routes size away from the book.

**Files:** Create `move/sources/rfq.move`, `move/tests/rfq_tests.move`, `lib/rfq.ts`. 

- [ ] **Task 8.1:** `rfq.move` — `Quote { structure_hash, premium, maker, expiry_ms, nonce }`; `fill_quote<Quote>(&mut Predict, &mut StructuredVault | &mut PredictManager, signed_quote, maker_sig, ...)` verifies the maker's `ed25519` signature over the canonical quote bytes, checks TTL + nonce-unused, then mints the legs atomically at the agreed premium. TDD: a valid sig fills; a tampered premium / expired TTL / replayed nonce aborts (`EBadSig`/`EExpired`/`ENonceUsed`). Commit.
- [ ] **Task 8.2:** `lib/rfq.ts` — taker requests a structure → maker daemon prices it off the (arb-guarded, impact-aware) engine → signs → returns; taker submits `fill_quote` PTB. Unit-test the canonical-bytes hashing matches Move's `bcs` layout. Commit.
- [ ] **Task 8.3:** Router: orders below a size threshold mint on the SVI book (Phase 1B path); orders above route to RFQ. Test the threshold logic. Commit.

**VERIFY-FIRST:** Sui `ed25519` verify in Move (`sui::ed25519`); exact BCS serialization of the quote struct so off-chain signing matches on-chain `verify`. **Gate:** `sui move test` green; signed whole-structure fills atomically, replay/tamper-proof.

---

## PHASE 9 — On-Chain Creator Economy (builder codes + Kiosk royalties)

**Why:** supply-side flywheel. Hyperliquid builder codes paid **>$40M to builders** and drove **40% of DAUs** via third-party UIs with a trivial per-order fee field. Strategists who publish vaults/structures should earn on the flow they create — this is the growth loop, and it fits the user's social-platform grain.

**Files:** Modify `move/sources/vault.move` (+ a `publisher` field) and `studio.move` (mint attribution); create `move/sources/note_kiosk.move`, tests, `lib/creator.ts`.

- [ ] **Task 9.1 — builder-code fee attribution:** add an optional `publisher: address` + `fee_bps` (≤ a hard cap, e.g. 10 bps = 0.1%) to `build_and_mint` / `vault::deposit`; the fee is split off the premium/deposit and paid to the publisher in the same PTB. TDD: fee routed exactly, capped, zero-publisher path unaffected. Commit.
- [ ] **Task 9.2 — Kiosk royalty notes:** `note_kiosk.move` wraps a *bespoke* structured note as a `StudioNote` object placed in a `Kiosk` with a `TransferPolicy` royalty rule (bps) + lock rule, so the strategist earns on every secondary resale. TDD: a resale pays the royalty; the lock rule blocks royalty-dodging transfers. Commit.
- [ ] **Task 9.3 — leaderboard indexer:** extend `indexer.ts` to rank publishers by attributed volume / realized payoff; surface to UI. Unit-test the aggregation. Commit.

**VERIFY-FIRST:** Kiosk `TransferPolicy` + `royalty_rule` + `lock_rule` API on testnet. **Anti-gaming (ship now):** capacity-cap the fee-eligible TVL per new publisher until track record matures; defer wash-trade ML. **Gate:** `sui move test` green; fees + royalties flow to strategists; leaderboard populates from events.

---

## PHASE 10 — Cross-Margin Portfolio (NAV aggregation + scenario grid + borrow-against-portfolio)

**Why it's cheap here and expensive elsewhere:** because every note is **long-only with provable bounded max-loss**, the hardest part of a cross-margin engine (liquidation under unbounded short risk) *disappears*. We get a portfolio NAV, an Aevo-style scenario-shock dashboard, and a "borrow against your whole book up to its worst-case floor" credit line — the last is genuinely novel and *only possible because loss is bounded*.

**Files:** Create `lib/portfolio.ts`, `lib/portfolio.test.ts`, `app/components/PortfolioPanel.tsx`; (stretch) `move/sources/studio_collateral.move` shared with P5e.

- [ ] **Task 10.1 — bounded-loss NAV aggregation:** `portfolioNav(positions, svi, forward)` = Σ marked value of each note (reuse `nav.ts`); also returns Σ worst-case floor (provable min redemption). TDD on a 3-note book. Commit.
- [ ] **Task 10.2 — scenario-grid risk (Aevo 15-shock):** `scenarioGrid(positions, svi, forward)` reprices the whole book across spot `±20%` (with intermediate steps) × IV `+50%/−25%` shocks; returns the P&L matrix + aggregate delta/vega (additive, since all long). TDD asserts grid shape + monotonicity where expected. Commit.
- [ ] **Task 10.3 — `PortfolioPanel.tsx`:** render NAV, the scenario heatmap, portfolio greeks, and borrow capacity = `Σ worstCaseFloor · LTV`. Commit.
- [ ] **Task 10.4 (stretch) — borrow-against-portfolio:** extend the P5e isolated market to accept the *portfolio* worst-case floor as collateral basis; lend dUSDC up to `LTV · floor`. Liquidation-light (floor is provable, no margin spiral). TDD the health-factor math. Commit.

**Gate:** `pnpm vitest run` green; portfolio NAV + scenario grid render from live (or fixture) SVI; borrow capacity computed from provable floors.

---

## Updated Effort, Matrix & Honest Reckoning

**Revised effort (the month is now real and visible, not buried):**

| Block | Phases | Est. |
|---|---|---|
| Engine (deep) | 1, 1A, 1B, 1C | ~2 wk — arb guard, impact model, MILP all need numerical hardening + validation |
| Core + Vault + Tranche | 2(done), 3, 4 | ~1.5 wk |
| RFQ + Creator + Portfolio | 8, 9, 10 | ~1.5 wk — new Move modules (sig-verify, kiosk, fee split) + portfolio math |
| Composability mesh | 5a–5e | ~1.5–2 wk |
| UX + demo + live e2e | 6, 7 | ~1.5 wk |

→ ~8–9 weeks solo; a focused month with AI. The depth is in 1A/1B/1C and P8 (real cryptography + real quant), not feature count.

**New mechanics → source map (additive to Part I matrix):**

| Source | Mechanic | Lands in |
|---|---|---|
| Gatheral–Jacquier / Martini–Mingone | Arb-free SVI guard + RND repair | P1A ★ |
| Almgren–Chriss + vendored spread formula | Impact-aware sequential pricing, optimal order/split | P1B ★ |
| Tropp / Davenport–Wakin / submodular greedy | MILP exact solve + coherence certificate | P1C ★ |
| Paradigm / Hashflow / Ribbon auctions | Signed-quote RFQ for whole structures | P8 ★ |
| Hyperliquid builder codes | Per-mint fee attribution to strategists | P9 |
| Sui Kiosk TransferPolicy | Royalty on note resale | P9 |
| Aevo portfolio margin / Drift / GMX V2 | Scenario-grid risk + cross-margin NAV | P10 |
| (long-only structural edge) | Borrow against provable worst-case floor | P10.4 ★ |

**Updated judging alignment:** Technical (20%) now has *four* defensible hard kernels (arb-free density repair, impact-aware optimizer, MILP+certificate, ed25519 RFQ) — not one. Real-world (50%) gains the creator-economy flywheel + portfolio credit line. This is no longer "a UI over a primitive."

**Still permanently out (C2):** the maker/short side of RFQ lives on Predict's book, *not* in our protocol; we never write naked exposure. Borrow-against-portfolio is liquidation-light *only* because loss is bounded — do not generalize it to unbounded instruments.

---

## Self-Review (run against spec)
- **Coverage:** all pillars (Part I six + Part II three) have phases; every research mechanic across all four sweeps maps to a task or is explicitly cut. Deepened kernels 1A/1B/1C grounded in cited math + vendored source. ✓
- **Type consistency:** `SparseTarget`/`SparseSolution`/`Leg` across P1/1C; `SVI` across 1A/1B; `AmmState`/`ImpactParams` introduced in 1B and reused by `optimizeBasket`; `StructuredVault<Quote>`/`Coin<STUDIO_LP>` across P2–P10; `Quote` (RFQ) hashing matches BCS in P8. ✓
- **Placeholders:** Part I P1–P2 and Part II 1A/1B/1C are code-complete to the failing-test level; P3–P10 are task-level with exact specs + `VERIFY-FIRST` where live SDK/crypto confirmation is required (honest, not hand-waved). ✓
- **Grounding:** §0 pricing facts are quoted from vendored source with file:line; quant kernels cite Gatheral–Jacquier, Almgren–Chriss, Tropp/Davenport–Wakin. No invented APIs. ✓
