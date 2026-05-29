# Predict Studio — Implementation Plan

> **For agentic workers (Codex or Claude):** This plan is fully self-contained. All Sui/DeepBook-Predict ground truth, the real on-chain API, scaling conventions, the decomposition math, and the gas budget are baked in below — you should not need to re-research anything. Implement task-by-task; steps use checkbox (`- [ ]`) syntax. Run the verification command after each task before moving on. Commit after each task (conventional commits).

**Goal:** Ship a polished, working-on-testnet **defined-risk options-strategy builder for DeepBook Predict** — pick a payoff shape, the engine synthesizes it from Predict binary/range legs (choosing the *cheapest* decomposition off the live SVI vol surface), previews the payoff curve + EV + max-loss/max-gain, mints it atomically as one `StructuredPosition` with a chain-enforced loss envelope, and settles it at expiry.

**Architecture:** A thin Move package (`predict_studio`) that wraps N DeepBook-Predict legs into one owned `StructuredPosition` object and enforces the worst-case-loss bound atomically in the mint PTB; a TypeScript engine (`lib/`) that decomposes payoff shapes into legs, runs a cheapest-decomposition cost optimizer using Predict's on-chain preview functions, and computes payoff/EV/probability/Greeks from the readable SVI surface; a Next.js 16 / React 19 UI (`app/`) with an interactive payoff-diagram builder; and a backtester that replays structures against the public Predict indexer.

**Tech Stack:** Sui Move (edition 2024.beta), `@mysten/sui` ^2.17, `@mysten/dapp-kit` ^1.0.6, Next.js ^16, React ^19, Tailwind ^4, `@tanstack/react-query`, a lightweight charting lib (recharts or visx) for payoff diagrams. Node 26 / pnpm. Sui CLI 1.73+.

---

## 0. Context (why this exists — read once)

**Event:** Sui Overflow 2026 hackathon. **Track:** DeepBook Predict (specialized, sponsor-judged). **Submission deadline: June 21, 2026 (Pacific)** — confirmed authoritative from the 2026 Participant Handbook (the "May 23" on overflow.sui.io is stale 2025 content). Shortlist Jul 8, Demo Day Jul 20–21, winners Aug 27. Submission portal = DeepSurge. Prize: DeepBook 1st $35k (2nd $15k / 3rd $7.5k / 4th $5k). Award 50% on win, 50% on mainnet deploy.

**Judging weights drive every priority:** ~50% Real-World Application · 20% Product & UX · 20% Technical · 10% Presentation. **≈80% is execution, only 20% is novelty.** DeepBook judges "test the entire flow" and require **simulation results** for vault/strategy work. → Build the most polished, genuinely-useful, end-to-end-working product; a clean ≤5-min demo beats clever-but-broken.

**Why this idea (it survived an 8-idea adversarial elimination):** DeepBook Predict exposes raw, all-or-nothing **binary** and **vertical range** instruments, all priced continuously off an on-chain SVI vol surface. No trader thinks in raw digitals; they think in *defined-risk shapes* (spreads, capped bets, protection floors). Today, expressing a shape on Predict means manually minting many legs and doing the math yourself — nobody does. Predict Studio is the missing UX layer. Mysten's own launch post says verbatim: *"[Predict] composes with other Predict positions, so spreads and structured products become a question of UX, not infrastructure."* This builds exactly that UX, ahead of the protocol's roadmap (V1 ships only binaries + ranges; "composable spreads are next").

**Competitive positioning (do NOT drift from this):** Pitch as a **builder / terminal** ("the Aevo/Deribit strategy builder for Predict"), non-custodial, one-position-out. **NOT a vault** — the vault lane is occupied (Floe, strata-sui, capletfi). Every Sui competitor is a single-strategy vault or a single-position CLI; **none has a payoff diagram, Greeks, or a multi-leg builder.** So even table-stakes features differentiate here; the cost optimizer + on-chain loss envelope + verifiable analytics are white-space nobody on any chain has.

**Explicitly out of scope / do NOT build:** mainnet deploy; a vault product; Seal/Walrus/Nautilus core dependence (optional Walrus term-sheet only); leverage/margin loops (the `deepbook_margin`↔`predict` integration does not exist in the contracts); shorting (the instruments are long-only — see §2). Reusing the Umbra UI shell (`~/repo/umbra/ui`) for the Next.js/Tailwind/dapp-kit scaffold is encouraged and **must be disclosed** in the submission.

---

## 1. Ground truth — the verified on-chain API

All of the following is **read from the real source** at branch `predict-testnet-4-16` of `github.com/MystenLabs/deepbookv3`, package `packages/predict` (package name `deepbook_predict`). The scaffold already vendors these into `move/build/predict_studio/sources/dependencies/deepbook_predict/*.move` — read those files directly if you need a function body.

### 1.1 Scaling conventions (from `constants.move` — CRITICAL, get this right)
- **Prices / percentages: FLOAT_SCALING = 1e9.** `500_000_000` = 50% = a $0.50 option price. `float_scaling() = 1_000_000_000`.
- **Quantities / money: Quote units = dUSDC with 6 decimals.** `1_000_000` quote units = 1 contract = `$1`. At settlement a winning contract pays `quantity` directly (already in USDC units).
- So minting `quantity = 1_000_000` (one contract) of a binary that costs `ask = 400_000_000` (= $0.40) costs `math::mul(ask, quantity) = 400_000` quote units = $0.40, and pays `1_000_000` (= $1) if it wins.
- Use `deepbook::math` (`mul`/`div`) for all fixed-point ops; never hand-roll.
- Other defaults: `default_min_ask_price = 10_000_000` (1%), `default_max_ask_price = 990_000_000` (99%), `default_max_total_exposure_pct = 800_000_000` (80%), `staleness_threshold_ms = 30_000`, `oracle_strike_grid_ticks = 100_000`.

### 1.2 Key builders (`market_key.move`, `range_key.move`)
```move
// market_key
public fun up(oracle_id: ID, expiry: u64, strike: u64): MarketKey     // digital CALL: pays $1 if settlement is above strike
public fun down(oracle_id: ID, expiry: u64, strike: u64): MarketKey   // digital PUT:  pays $1 if settlement is below strike
public fun new(oracle_id: ID, expiry: u64, strike: u64, is_up: bool): MarketKey
public fun oracle_id(&MarketKey): ID; expiry(&MarketKey): u64; strike(&MarketKey): u64; is_up(&MarketKey): bool; is_down(&MarketKey): bool

// range_key — a vertical range priced as a SINGLE native instrument (= a digital vertical spread)
public fun new(oracle_id: ID, expiry: u64, lower_strike: u64, higher_strike: u64): RangeKey  // pays $1 if settlement ∈ (lower, higher]
public fun oracle_id(&RangeKey): ID; expiry(&RangeKey): u64; lower_strike(&RangeKey): u64; higher_strike(&RangeKey): u64
```

### 1.3 Trade + preview functions (`predict.move`)
```move
// VIEW (no signer, safe to devInspect): returns (ask_cost, bid_payout) in quote units for `quantity`.
public fun get_trade_amounts(predict: &Predict, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock): (u64, u64)
public fun get_range_trade_amounts(predict: &Predict, oracle: &OracleSVI, key: RangeKey, quantity: u64, clock: &Clock): (u64, u64) // (mint_cost, redeem_payout)
public fun ask_bounds(predict: &Predict, oracle_id: ID): (u64, u64)

// MUTATING. Pays the cost by pulling from the manager's internal BalanceManager (manager must be funded). Prices POST-trade.
public fun mint<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun mint_range<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: RangeKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)

// Redeem (settle). redeem_permissionless requires oracle.is_settled(); deposits payout back into the manager.
public fun redeem<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun redeem_permissionless<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: MarketKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
public fun redeem_range<Quote>(predict: &mut Predict, manager: &mut PredictManager, oracle: &OracleSVI, key: RangeKey, quantity: u64, clock: &Clock, ctx: &mut TxContext)
```
Notes: `mint` asserts `ctx.sender() == manager.owner()`, `!trading_paused`, `quantity > 0`, quote-asset match, live oracle, mintable ask within `ask_bounds`, and `assert_total_exposure`. Because mint/redeem/mint_range/redeem_range all take `&mut Predict` + `&mut PredictManager`, **N legs compose in one PTB** against the same two objects (no per-tx leg cap exists in the package).

### 1.4 Manager (`predict_manager.move`)
```move
public fun owner(&PredictManager): address
public fun position(&PredictManager, key: MarketKey): u64
public fun range_position(&PredictManager, key: RangeKey): u64
public fun balance<T>(&PredictManager): u64
public fun deposit<T>(&mut PredictManager, coin: Coin<T>, ctx: &TxContext)   // FUND the manager before minting
public fun withdraw<T>(&mut PredictManager, amount: u64, ctx: &mut TxContext): Coin<T>
```
(Positions are quantity rows inside the manager, NOT objects. A `StructuredPosition` therefore records the manager id + the leg keys; it does not own per-leg objects.) Find the manager-creation entry (`new`/`create_manager`) by grepping the vendored `predict_manager.move` / `predict.move`; it wraps a DeepBook `BalanceManager`.

### 1.5 Oracle (`oracle.move`, type `OracleSVI`)
```move
public fun id(&OracleSVI): ID
public fun underlying_asset(&OracleSVI): String
public fun spot_price(&OracleSVI): u64
public fun forward_price(&OracleSVI): u64
public fun svi(&OracleSVI): SVIParams
public fun svi_a(&SVIParams): u64; svi_b(&SVIParams): u64; svi_rho(&SVIParams): i64::I64; svi_m(&SVIParams): i64::I64; svi_sigma(&SVIParams): u64
public fun expiry(&OracleSVI): u64; timestamp(&OracleSVI): u64
public fun settlement_price(&OracleSVI): Option<u64>
public fun is_settled(&OracleSVI): bool; is_active(&OracleSVI): bool; status(&OracleSVI, &Clock): u8
```
Testnet is BTC-only with ~hourly rolling expiries. `OracleSVI` is a shared object; its params + the on-chain math lib (`math::ln/exp/normal_cdf/sqrt`, `F = 1e9` fixed point) let you reproduce prices/Greeks off-chain AND on-chain (verifiable analytics).

### 1.6 Off-chain endpoints / deps
- Public indexer: `https://predict-server.testnet.mystenlabs.com` — endpoints incl. `/oracles`, `/managers/:id/positions/summary`, `/managers/:id/pnl`, vault summary, prices/latest, and full history (minted/redeemed/supplies/withdrawals/trades). Used for live data + the backtester. **Verify exact routes on day 1** by curling `/oracles`.
- Quote asset on testnet = **dUSDC** (NOT testnet USDC). Request via the Tally form `https://tally.so/r/Xx102L` (gating — do first). Token type is `…::dusdc::DUSDC`.
- Predict docs: `https://docs.sui.io/onchain-finance/deepbook-predict/`. DeepBook sandbox (local stack): `https://github.com/MystenLabs/deepbook-sandbox`.

### 1.7 THE defining property (this shapes the whole design)
Every Predict instrument is **long-only** (mint to open, redeem to close — there is no sell-to-open) and pays **at most `$1 · quantity`**. Therefore for any basket of legs:
- **Max loss = total premium paid.** You can never lose more than you paid. Defined-risk is automatic — the on-chain "loss envelope" is just `assert!(premium_paid <= max_loss_budget)`.
- **Max gain** = the maximum over the settlement domain of (sum of legs that pay at that settlement) − premium.
- Payoff at settlement `S` = `Σ_legs (qty_i if leg_i wins at S else 0) − premium`.
- A leg's **ask price (1e9-scaled) ≈ its risk-neutral probability of paying** (digitals are priced as probabilities). So implied probability and EV come for free from the preview functions.

---

## 2. Instrument set → payoff vocabulary (the decomposition library)

Long-only building blocks and what they express:
- `up(K)` digital call — pays $1 if `S > K`. (bullish)
- `down(K)` digital put — pays $1 if `S < K`. (bearish)
- `range(K1,K2)` — pays $1 if `K1 < S ≤ K2`. (in-the-band; a single native vertical)

Templates Predict Studio offers (all defined-risk, all long-only) and their canonical decomposition:

| Template | View | Legs |
|---|---|---|
| **Digital Call** | bullish, capped | `up(K) × q` |
| **Digital Put** | bearish, capped | `down(K) × q` |
| **In-the-Band (Range bet)** | range-bound | `range(K1,K2) × q` |
| **Capped Bull / Bear** | directional w/ explicit max loss & max gain | `up(K)`/`down(K)` sized so premium = max-loss, `q×$1` = max-gain |
| **Bull/Bear Ramp** (staircase) | directional, smooth payoff | ladder of `range(K_i,K_{i+1})` with increasing/decreasing quantities |
| **Peak / "pin near K"** (digital butterfly) | low-vol, expects pinning | `range(K−w, K+w)`; finer = staircase of ranges peaking at K |
| **Strangle / "big move"** | high-vol, either direction | `up(K_hi) + down(K_lo)` |
| **Protection Floor** | hedge a long view's downside | `down(K) × q` to offset loss below K |

Anything requiring a naked short or unbounded payoff is **not expressible** — that's fine; this is a *defined-risk* builder.

---

## 3. Cost optimizer (the signature feature)

The same target payoff can be assembled multiple ways off the one shared SVI surface, and each candidate has a different live ask cost AND a different leg count (→ gas). The optimizer:
1. Given a target payoff (a piecewise-constant function over the strike grid, expressed as a set of contiguous "win regions" with per-region quantity), enumerate a small set of **valid long-only decompositions**:
   - **Native-range** form: one `range()` per bounded win-region; `up()`/`down()` for unbounded tail regions.
   - **Coarse** form: merge adjacent equal-quantity regions into a single wider range.
   - **Binary-ladder** form: express each region via `up(K_i) − up(K_{i+1})`… (cannot short, so only used where it reduces to fewer legs, e.g. a single `up()` for an above-K tail).
2. Price each candidate by calling `get_trade_amounts` / `get_range_trade_amounts` via `devInspectTransactionBlock` (no signer, no gas) for every leg, summing `ask_cost`.
3. Pick the candidate with the **lowest total ask cost**, tie-broken by **fewest legs** (gas). Surface the chosen decomposition + the savings vs the naive form in the UI.

This is unique because elsewhere strikes/instruments live in siloed books; here all legs price off one on-chain surface so equivalent decompositions are directly comparable. Fewer legs ⇒ cheaper ⇒ less gas (synergy with the gas cap in §4).

---

## 4. The gas constraint (must be measured day 1)

Each `mint`/`mint_range` re-runs a ~50-point SVI curve build + a strike-matrix page sweep, so per-leg gas is heavy. Sui's per-tx computation cap is **5,000,000 units**. Empirically expect ~10 legs/PTB to be safe and 15–20 to be the risk zone. **Task 1 below benchmarks this and fixes the engine's `MAX_LEGS_PER_PTB`.** If a structure needs more legs than the cap allows, split the mint across sequential PTBs (the `StructuredPosition` is created in the first and passed to subsequent mints). The cost optimizer's fewest-legs tie-break directly mitigates this.

---

## 5. File structure

```
predict-studio/
  move/
    Move.toml                         # deps deepbook_predict @ predict-testnet-4-16 (already wired, builds green)
    sources/studio.move               # StructuredPosition + build_and_mint + settle + loss envelope (Task 2–4)
    tests/studio_tests.move           # Move unit tests (Task 2–4)
  lib/
    types.ts                          # shared types: Leg, TargetPayoff, Decomposition, StructureQuote
    predict-client.ts                 # read oracles/manager, build mint/settle PTBs, devInspect previews (Task 6)
    decompose.ts                      # template → legs; freeform payoff → legs (Task 7)
    optimizer.ts                      # cheapest-decomposition optimizer (Task 8)
    payoff.ts                         # payoff curve, max-loss/gain, breakevens, EV, implied prob, Greeks (Task 9)
    backtest.ts                       # replay a structure vs indexer history (Task 12)
    indexer.ts                        # typed client for predict-server.testnet (Task 6)
  app/                                # Next.js 16 app-router UI (reuse umbra/ui scaffold) (Task 10–11)
    app/page.tsx, app/layout.tsx, app/providers.tsx
    components/Builder.tsx, PayoffChart.tsx, TemplatePicker.tsx, ScenarioSliders.tsx,
               StructureSummary.tsx, PositionsDashboard.tsx, MintButton.tsx, Backtester.tsx
  scripts/
    gas-benchmark.ts                  # Task 1 — measures legs/PTB vs 5M cap
    deploy.ts                         # publish the Move package to testnet, write deploy.json (Task 5)
    setup-manager.ts                  # create + fund a PredictManager with dUSDC (Task 5)
  IMPLEMENTATION_PLAN.md              # this file
  README.md                           # Task 13
```

---

## Phase 0 — Environment & de-risk (Day 1)

### Task 1: Gas benchmark — fix the legs-per-PTB budget
**Files:** Create `scripts/gas-benchmark.ts`. Prereq (manual): submit the dUSDC Tally form and have a funded testnet wallet keypair available as env `SUI_KEYPAIR` (base64 secret) + `SUI_RPC=https://fullnode.testnet.sui.io:443`.

- [ ] **Step 1: Read live protocol object IDs.** `curl -s https://predict-server.testnet.mystenlabs.com/oracles | jq` to get the `Predict` shared object id, a live BTC `OracleSVI` id, its `expiry`, strike grid (`min_strike`, `tick_size`), and the dUSDC type. Record them in `scripts/config.json`.
- [ ] **Step 2: Write the benchmark.** For `n` in `[1,3,5,8,10,12,15,20]`, build a PTB that creates/funds a manager (or reuses one) and mints `n` legs (mix of `mint` and `mint_range` at distinct grid strikes), then `devInspectTransactionBlock` it and read `effects.gasUsed.computationCost`. Print a table `n → computationCost` and the largest `n` with `computationCost < 5_000_000`.

```ts
// scripts/gas-benchmark.ts  (sketch — fill object ids from config.json)
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import cfg from "./config.json";
const client = new SuiClient({ url: process.env.SUI_RPC! });
const PKG = "0x...deepbook_predict_pkg"; // from /oracles or docs
for (const n of [1,3,5,8,10,12,15,20]) {
  const tx = new Transaction();
  // assumes an existing funded manager id in cfg.manager; else create+fund first
  for (let i = 0; i < n; i++) {
    const strike = cfg.minStrike + (i + 1) * cfg.tickSize * 10;
    const key = tx.moveCall({ target: `${PKG}::market_key::up`,
      arguments: [tx.pure.id(cfg.oracle), tx.pure.u64(cfg.expiry), tx.pure.u64(strike)] });
    tx.moveCall({ target: `${PKG}::predict::mint`, typeArguments: [cfg.dusdcType],
      arguments: [tx.object(cfg.predict), tx.object(cfg.manager), tx.object(cfg.oracle), key,
        tx.pure.u64(1_000_000), tx.object("0x6")] });
  }
  const r = await client.devInspectTransactionBlock({ sender: cfg.sender, transactionBlock: tx });
  console.log(n, r.effects?.gasUsed?.computationCost, r.effects?.status?.status);
}
```

- [ ] **Step 3: Run it.** `pnpm tsx scripts/gas-benchmark.ts`. Expected: a monotic table; identify `MAX_LEGS_PER_PTB`.
- [ ] **Step 4: Record the result** in `lib/types.ts` as `export const MAX_LEGS_PER_PTB = <measured>;` (fallback 8 if devInspect is flaky). 
- [ ] **Step 5: Commit.** `git add scripts/gas-benchmark.ts scripts/config.json lib/types.ts && git commit -m "chore: benchmark Predict mint gas, fix legs-per-PTB budget"`

**Gate:** if even `n=3` exceeds the cap or every mint aborts (e.g. no dUSDC), STOP and resolve tokens/objects before continuing — this is the load-bearing assumption.

---

## Phase 1 — Move package (Days 2–6)

The Move package is intentionally thin: Predict does pricing/settlement; `predict_studio` only (a) wraps legs into one owned object, (b) enforces `premium_paid <= max_loss_budget` atomically, (c) emits indexer events. The skeleton in `sources/studio.move` already compiles (`StructuredPosition`, `Leg`, events, getters).

### Task 2: `build_and_mint` — atomic multi-leg mint with loss envelope
**Files:** Modify `move/sources/studio.move`. Test `move/tests/studio_tests.move`.

- [ ] **Step 1: Write the failing test** (`move/tests/studio_tests.move`): using `deepbook_predict`'s own test scaffolding (see vendored `predict.move` `#[test_only]` helpers — grep `test_only` / `init_for_testing`), set up a `Predict` + `OracleSVI` + funded `PredictManager`, then call `studio::build_and_mint` with two legs (`up(K1)` + `range(K2,K3)`) and a generous `max_loss_budget`. Assert a `StructuredPosition` is returned with `leg_count()==2`, `premium_paid() > 0`, `max_loss()==premium_paid()`.
- [ ] **Step 2: Run, expect fail:** `sui move test build_and_mint -p move` → FAIL (function missing).
- [ ] **Step 3: Implement `build_and_mint`.** Signature & body:

```move
const EMaxLossExceeded: u64 = 1;
const ETooManyLegs: u64 = 2;
const ENotOwner: u64 = 3;
const EAlreadySettled: u64 = 4;

/// Atomically mint every leg of a structure, enforce the worst-case-loss budget,
/// and return one owned StructuredPosition. Pricing/payment happen inside Predict;
/// the manager must already be funded with `Quote`.
public fun build_and_mint<Quote>(
    predict: &mut deepbook_predict::predict::Predict,
    manager: &mut deepbook_predict::predict_manager::PredictManager,
    oracle: &deepbook_predict::oracle::OracleSVI,
    shape: String,
    legs: vector<Leg>,
    max_loss_budget: u64,           // quote units; revert if total premium exceeds this
    clock: &Clock,
    ctx: &mut TxContext,
): StructuredPosition {
    use deepbook_predict::predict;
    use deepbook_predict::market_key;
    use deepbook_predict::range_key;
    assert!(ctx.sender() == manager.owner(), ENotOwner);
    assert!(legs.length() > 0 && legs.length() <= 24, ETooManyLegs); // hard upper bound; UI enforces the gas budget

    let oracle_id = oracle.id();
    let expiry = oracle.expiry();
    let balance_before = manager.balance<Quote>();

    let mut i = 0;
    while (i < legs.length()) {
        let leg = &legs[i];
        if (leg.is_range) {
            let key = range_key::new(oracle_id, expiry, leg.lower_strike, leg.higher_strike);
            predict::mint_range<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
        } else {
            let key = market_key::new(oracle_id, expiry, leg.lower_strike, leg.is_up);
            predict::mint<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
        };
        i = i + 1;
    };

    // Each mint pulled its premium from the manager balance; the delta is total premium.
    let balance_after = manager.balance<Quote>();
    let premium_paid = balance_before - balance_after;
    assert!(premium_paid <= max_loss_budget, EMaxLossExceeded);

    let max_gain = max_payout(&legs);   // see Task 3
    let pos = StructuredPosition {
        id: object::new(ctx), owner: ctx.sender(), manager_id: object::id(manager),
        oracle_id, expiry_ms: expiry, shape, legs, premium_paid,
        max_loss: premium_paid, max_gain, settled: false,
    };
    event::emit(StructureMinted {
        position_id: object::id(&pos), owner: pos.owner, shape: pos.shape,
        leg_count: pos.legs.length(), premium_paid, max_loss: premium_paid, max_gain,
    });
    pos
}

/// Entry wrapper that transfers the position to the sender.
public entry fun build_and_mint_to_sender<Quote>(
    predict: &mut deepbook_predict::predict::Predict,
    manager: &mut deepbook_predict::predict_manager::PredictManager,
    oracle: &deepbook_predict::oracle::OracleSVI,
    shape: String, legs: vector<Leg>, max_loss_budget: u64, clock: &Clock, ctx: &mut TxContext,
) {
    let pos = build_and_mint<Quote>(predict, manager, oracle, shape, legs, max_loss_budget, clock, ctx);
    transfer::public_transfer(pos, ctx.sender());
}
```
Add the necessary `use` imports at module top (`std::string::String`, `sui::{object, transfer, tx_context::TxContext, clock::Clock, event}`).

- [ ] **Step 4: Run, expect pass:** `sui move test build_and_mint -p move` → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(move): build_and_mint with atomic loss-envelope enforcement"`

### Task 3: `max_payout` helper (on-chain max-gain)
**Files:** Modify `move/sources/studio.move`. Test in `studio_tests.move`.

- [ ] **Step 1: Failing test** — `max_payout` of `[up(70000)×1e6, range(68000,70000)×1e6]` should equal the max over breakpoints of summed winning quantities. For these legs the regions are: `S≤68000`→0; `68000<S≤70000`→ range pays (1e6); `S>70000`→ up pays (1e6). Max = `1_000_000`. Assert `== 1_000_000`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** Collect all distinct strike breakpoints from the legs, evaluate total winning quantity in each open interval between consecutive breakpoints (and the two tails), return the max.

```move
fun leg_pays(leg: &Leg, s: u64): bool {
    if (leg.is_range) { s > leg.lower_strike && s <= leg.higher_strike }
    else if (leg.is_up) { s > leg.lower_strike }
    else { s < leg.lower_strike }
}
fun max_payout(legs: &vector<Leg>): u64 {
    // Sample just below/above each breakpoint; digital payoffs are piecewise-constant so sampling breakpoints suffices.
    let mut bps = vector<u64>[];
    let mut i = 0;
    while (i < legs.length()) { let l = &legs[i]; bps.push_back(l.lower_strike); if (l.is_range) bps.push_back(l.higher_strike); i = i + 1; };
    let mut best = 0; let mut j = 0;
    while (j < bps.length()) {
        // test a point just above the breakpoint (region representative)
        let s = bps[j] + 1;
        let mut sum = 0; let mut k = 0;
        while (k < legs.length()) { let l = &legs[k]; if (leg_pays(l, s)) sum = sum + l.quantity; k = k + 1; };
        if (sum > best) best = sum;
        j = j + 1;
    };
    best
}
```
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(move): on-chain max_payout for structured positions"`

### Task 4: `settle` — redeem all legs at expiry, compute net P&L
**Files:** Modify `move/sources/studio.move`. Test in `studio_tests.move`.

- [ ] **Step 1: Failing test** — settle the position from Task 2's test after advancing the oracle to a settled state (use the vendored test helpers to set `settlement_price`); assert a `StructureSettled` event with the correct `payout` and that `is_settled()` becomes true.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement `settle`** — loop legs, call `predict::redeem_permissionless` / `redeem_range` (after `oracle.is_settled()`), measure manager-balance delta as `payout`, set `settled=true`, emit event, return the position to owner (or keep as a settled receipt).

```move
public fun settle<Quote>(
    predict: &mut deepbook_predict::predict::Predict,
    manager: &mut deepbook_predict::predict_manager::PredictManager,
    oracle: &deepbook_predict::oracle::OracleSVI,
    pos: &mut StructuredPosition,
    clock: &Clock, ctx: &mut TxContext,
) {
    use deepbook_predict::predict; use deepbook_predict::market_key; use deepbook_predict::range_key;
    assert!(!pos.settled, EAlreadySettled);
    assert!(oracle.is_settled(), 5);
    let before = manager.balance<Quote>();
    let mut i = 0;
    while (i < pos.legs.length()) {
        let leg = &pos.legs[i];
        if (leg.is_range) {
            let key = range_key::new(pos.oracle_id, pos.expiry_ms, leg.lower_strike, leg.higher_strike);
            predict::redeem_range<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
        } else {
            let key = market_key::new(pos.oracle_id, pos.expiry_ms, leg.lower_strike, leg.is_up);
            predict::redeem_permissionless<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
        };
        i = i + 1;
    };
    let payout = manager.balance<Quote>() - before;
    pos.settled = true;
    let (gain, abs) = if (payout >= pos.premium_paid) (true, payout - pos.premium_paid) else (false, pos.premium_paid - payout);
    event::emit(StructureSettled { position_id: object::id(pos), owner: pos.owner, payout, pnl_is_gain: gain, pnl_abs: abs });
}
```
- [ ] **Step 4: Run, expect pass.** `sui move test -p move` (all tests).
- [ ] **Step 5: Commit.** `git commit -am "feat(move): settle redeems all legs and reports net P&L"`

### Task 5: Deploy + manager setup scripts
**Files:** `scripts/deploy.ts`, `scripts/setup-manager.ts`.
- [ ] **Step 1:** `deploy.ts` runs `sui client publish move --gas-budget 500000000`, parses the package id + any created objects, writes `deploy.json`.
- [ ] **Step 2:** `setup-manager.ts` creates a `PredictManager` (grep the vendored source for the creation entry), funds it via `predict_manager::deposit` with dUSDC, writes the manager id to `deploy.json`.
- [ ] **Step 3:** Run both on testnet; confirm a manager exists and shows a dUSDC balance via `/managers/:id/...`.
- [ ] **Step 4: Commit.** `git commit -am "feat(scripts): deploy package + create/fund PredictManager"`

---

## Phase 2 — TS engine (Days 7–12)

### Task 6: `predict-client.ts` + `indexer.ts`
**Files:** `lib/predict-client.ts`, `lib/indexer.ts`, `lib/types.ts`.
- [ ] **Step 1:** Define shared types in `lib/types.ts`: `Leg {isRange,isUp,lowerStrike,higherStrike,quantity}`, `TargetRegion {lo,hi,qty}` (hi=null ⇒ +∞), `TargetPayoff {regions:TargetRegion[]}`, `Decomposition {legs:Leg[], legCount:number}`, `StructureQuote {legs:Leg[], totalCost:number, maxLoss:number, maxGain:number, breakevens:number[], ev:number}`.
- [ ] **Step 2:** `indexer.ts` — typed `getOracles()`, `getManagerPositions(id)`, `getManagerPnl(id)`, `getPrices(oracleId)`, `getHistory(...)` against `predict-server.testnet`. **Verify routes by curling first.**
- [ ] **Step 3:** `predict-client.ts` — `quoteLeg(leg)` and `quoteRange(...)` via `devInspectTransactionBlock` calling `get_trade_amounts`/`get_range_trade_amounts` and decoding the `(u64,u64)` return (use `@mysten/sui/bcs` or read `results[].returnValues`); `buildMintTx(legs, shape, maxLoss, managerId)` producing a `Transaction` that calls `predict_studio::studio::build_and_mint_to_sender`; `buildSettleTx(positionId)`. Read `OracleSVI` fields via `getObject`.
- [ ] **Step 4: Test** (`vitest`): mock devInspect; assert `quoteLeg` decodes `(ask,bid)` correctly and `buildMintTx` emits the right `moveCall` targets/args. Run `pnpm vitest run lib/predict-client`.
- [ ] **Step 5: Commit.** `git commit -am "feat(lib): predict client + indexer client"`

### Task 7: `decompose.ts` — templates & freeform → legs
**Files:** `lib/decompose.ts`, `lib/decompose.test.ts`.
- [ ] **Step 1: Failing tests** for each template in §2. E.g. `decompose({template:'capped_bull', K:70000, qty:1e6})` → `[{isRange:false,isUp:true,lowerStrike:70000,higherStrike:0,quantity:1e6}]`; `decompose({template:'strangle', kLo, kHi, qty})` → `[down(kLo), up(kHi)]`; `decompose({template:'peak', center, width, qty})` → `[range(center-width,center+width,qty)]`; a freeform `TargetPayoff` of contiguous regions → one `range()` per bounded region + `up()/down()` per tail. Snap all strikes to `minStrike + n*tickSize`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** `decompose(spec): Decomposition` for each template + `decomposeFreeform(target, grid): Decomposition`. Pure functions; no chain calls.
- [ ] **Step 4: Run, expect pass.** `pnpm vitest run lib/decompose`.
- [ ] **Step 5: Commit.** `git commit -am "feat(lib): payoff decomposition library"`

### Task 8: `optimizer.ts` — cheapest decomposition
**Files:** `lib/optimizer.ts`, `lib/optimizer.test.ts`.
- [ ] **Step 1: Failing test** — given a target with two equal-qty adjacent bounded regions, the optimizer must compare the {two narrow ranges} vs {one merged wide range} candidates (mock `quoteLeg` so the merged form is cheaper) and return the merged form; assert `legCount===1` and that it reports `savings>0`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** `optimize(target, grid, quoteFns): Promise<{best:Decomposition, candidates:{legs,cost,legCount}[], savingsVsNaive:number}>` — enumerate native-range / merged-coarse / tail-binary candidates (per §3), price every leg via the injected quote fns (batched devInspect), pick min cost then min legs, never exceed `MAX_LEGS_PER_PTB` (drop candidates over budget). Inject quote fns for testability.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(lib): cheapest-decomposition cost optimizer"`

### Task 9: `payoff.ts` — curve, EV, probability, Greeks
**Files:** `lib/payoff.ts`, `lib/payoff.test.ts`.
- [ ] **Step 1: Failing tests** — `payoffCurve(legs, premium, gridPoints)` returns payoff at sampled settlements; `maxLoss===premium`; `maxGain===max(curve)`; `breakevens()` finds zero-crossings; `impliedProb(askPrice)===askPrice/1e9`; `ev(legs, quotes)` = Σ(prob_i·$1·qty_i) − premium; `greeks(svi, spot, strike, tau)` returns finite `delta/vega/theta` (finite-difference over the SVI price). Use a fixed SVI fixture.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** Port the SVI total-variance smile `w(k)=a+b(ρ(k−m)+√((k−m)²+σ²))` and N(d2) digital pricing from the vendored `oracle.move`/`math.move` (1e9 fixed point) into TS; compute Greeks by finite differences. Keep functions pure.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(lib): payoff/EV/probability/Greeks from the SVI surface"`

---

## Phase 3 — UI (Days 13–18)

Reuse `~/repo/umbra/ui` scaffold (Next 16 app-router, Tailwind 4, dapp-kit provider, terminal aesthetic). Disclose reuse in README.

### Task 10: App shell + wallet + live oracle panel
**Files:** `app/app/layout.tsx`, `app/app/providers.tsx` (dapp-kit `SuiClientProvider` testnet + `WalletProvider` + react-query), `app/app/page.tsx`, `app/components/OraclePanel.tsx`.
- [ ] **Step 1:** Copy the umbra providers/layout; point network at testnet; add `ConnectButton`.
- [ ] **Step 2:** `OraclePanel` fetches `getOracles()` + the chosen `OracleSVI` (spot, forward, expiry countdown, SVI params) via react-query and renders a live header.
- [ ] **Step 3:** Manual check `pnpm --filter app dev` → wallet connects, oracle data renders. 
- [ ] **Step 4: Commit.** `git commit -am "feat(ui): app shell, wallet, live oracle panel"`

### Task 11: The Builder — template picker, payoff chart, scenario sliders, mint
**Files:** `app/components/{Builder,TemplatePicker,PayoffChart,ScenarioSliders,StructureSummary,MintButton}.tsx`.
- [ ] **Step 1: `TemplatePicker`** — choose a template (§2) + inputs (strikes/width/qty/max-loss budget); on change, call `decompose` then `optimize` (debounced) to get the chosen `Decomposition` + quote.
- [ ] **Step 2: `PayoffChart`** — render `payoffCurve()` as an area/line chart (recharts/visx): x = settlement price, y = P&L; shade max-loss/max-gain; mark breakevens, spot, and the strikes. Add a second "today / mark-to-market" line for open positions.
- [ ] **Step 3: `ScenarioSliders`** — spot/IV/time-to-expiry sliders that re-price the curve live (re-run `payoff.ts` with shifted inputs). 
- [ ] **Step 4: `StructureSummary`** — show chosen decomposition, leg list, total cost, max-loss, max-gain, breakevens, implied probability, EV, and **"optimizer saved $X vs naive."**
- [ ] **Step 5: `MintButton`** — `buildMintTx(...)` and `signAndExecuteTransaction` via dapp-kit; show the digest + the created `StructuredPosition` id; toast on success.
- [ ] **Step 6: Manual check** — build a capped-bull on the live BTC oracle, see the curve + optimizer pick, mint on testnet, confirm the position object exists. 
- [ ] **Step 7: Commit.** `git commit -am "feat(ui): payoff builder with optimizer, scenario sliders, atomic mint"`

---

## Phase 4 — Manage, backtest, polish, submit (Days 19–22)

### Task 12: Positions dashboard + settle + backtester
**Files:** `app/components/{PositionsDashboard,Backtester}.tsx`, `lib/backtest.ts`, `lib/backtest.test.ts`.
- [ ] **Step 1:** `PositionsDashboard` lists the wallet's `StructuredPosition` objects (query by owner + type), shows live mark-to-market P&L (re-quote legs via `bid`), countdown to expiry, and a one-click **Settle** (`buildSettleTx`).
- [ ] **Step 2: Failing test** for `backtest(structure, history)` — given a fixture of historical settlements from the indexer, return hit-rate, avg P&L, P&L distribution. Implement; `pnpm vitest run lib/backtest`.
- [ ] **Step 3:** `Backtester` UI — "backtest this structure" runs `backtest()` against `getHistory()` and shows hit-rate + a P&L histogram (this satisfies the track's **simulation-results** requirement). Fallback to a synthetic-Monte-Carlo over the SVI surface if indexer history is thin.
- [ ] **Step 4: Commit.** `git commit -am "feat: positions dashboard, settle, backtester (sim results)"`

### Task 13: README, demo, submission
**Files:** `README.md`, `docs/DEMO.md`.
- [ ] **Step 1:** README — what/why, architecture diagram, the three signature features (cost optimizer, on-chain loss envelope, verifiable analytics), **"why DeepBook Predict specifically,"** disclosed reuse of the Umbra shell, deployed package id, how to run.
- [ ] **Step 2:** Record the ≤5-min demo (script in §6 below).
- [ ] **Step 3:** Submit on DeepSurge: public GitHub, demo video, deployed package id, logo, description. Tag the repo `v1.0-overflow`.
- [ ] **Step 4: Commit + tag.** `git commit -am "docs: README + demo" && git tag v1.0-overflow`

---

## 6. Demo script (≤5 min)
1. Connect wallet; show the live BTC `OracleSVI` (spot, expiry countdown, SVI smile).
2. Pick **Capped Bull**: "BTC up, max loss $50, cap gain ~$200, this hour." Watch the payoff curve render and the optimizer choose the cheapest decomposition ("saved $X vs naive").
3. Drag the **scenario sliders** (spot/IV/time) — the curve updates live; show EV + implied probability.
4. **Mint** — one atomic PTB; show the single `StructuredPosition` object and its N on-chain legs; highlight the **on-chain max-loss = premium** guarantee.
5. **Backtest** the structure against historical settlements (hit-rate + P&L histogram).
6. Ride the hourly expiry (or use a pre-seeded near-expiry oracle); **Settle** — payout matches the diagram exactly.

## 7. Verification gates (must pass before submit)
- `sui move test -p move` all green; package deployed to testnet (id in `deploy.json` + README).
- `pnpm vitest run` all green (`predict-client`, `decompose`, `optimizer`, `payoff`, `backtest`).
- End-to-end on testnet: build → optimize → mint (atomic, one position) → settle, with real dUSDC.
- Optimizer demonstrably picks a cheaper/fewer-leg decomposition than naive on at least one shape.
- Backtester produces real simulation results.
- Demo video ≤5 min; README states "why Predict," discloses reuse, lists package id.

## 8. Risks & mitigations
- **Gas/leg-cap** → Task 1 measures it; optimizer minimizes legs; split across PTBs if needed.
- **Long-only** → scope strictly to defined-risk shapes (§2); never pitch shorts/unbounded payoffs.
- **Testnet dUSDC / DEEP fee coin** (prior Umbra snag) → secure dUSDC via Tally on day 1; verify mint doesn't require a separate DEEP fee coin (grep vendored `mint` — Predict pulls premium from the manager balance, no DEEP fee path observed, but confirm on first real mint).
- **Indexer route/shape drift** → verify all routes by curling on day 1; types in `indexer.ts`.
- **Competitors (Floe/strata pivoting to a builder)** → build fast; lead with the builder/terminal framing + the optimizer; re-check their repos mid-build.
- **PredictManager creation API** → grep the vendored `predict_manager.move`/`predict.move` for the exact `new`/`create` entry before Task 5.

## 9. Self-review notes (done)
Spec coverage: every §1–§4 fact maps to a task (API→Tasks 2/4/6, optimizer→8, payoff/Greeks→9, gas→1, UI→10–12, sim→12). Type consistency: `Leg`/`Decomposition`/`StructureQuote`/`MAX_LEGS_PER_PTB` shared via `lib/types.ts`; Move `Leg` field order matches the TS `Leg` and the `new_leg` constructor. No placeholders left in logic steps.
