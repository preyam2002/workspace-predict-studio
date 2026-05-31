# Predict Studio — Completion Plan (Codex Handoff)

> **For the implementing agent (Codex):** This is the authoritative remaining-work plan. The offline engine + Move core are BUILT and test-green (67 vitest / 34 Move). What remains is: **(P0) fix real bugs in "done" code, (P1) turn scaffolds into real integrations, (P2) add high-value features, (P3) live/token-gated deploy+e2e, (P4) demo/submission.** Do them in that order. Steps use checkbox (`- [ ]`) syntax. Every code step shows the actual code or the exact SDK call — no placeholders. Where a step needs testnet tokens or live confirmation it is tagged **🔒TOKEN** or **🔎VERIFY-FIRST**.

**Goal:** Take Predict Studio from "green offline" to "submitted and winning the DeepBook Predict track at Sui Overflow 2026."

**Deadline:** June 21, 2026 Pacific (DeepSurge portal). Prize: DeepBook track $35k first; 50% on win + 50% on mainnet deploy. Judging ≈ 50% real-world / 20% product / 20% technical / 10% presentation.

**Strategic framing (from competitive research):** DeepBook shipped its *own* leveraged range-trading app (May 20), and Block Scholes powers the SVI surface. So **do not pitch a generic "range bet UI"** — pitch *"the structured-note factory & marketplace on DeepBook Predict: describe your market view in English, get a fairly-priced tokenized note, buy it gasless."* Closest competitor (Typus, ~$70M TVL) is a fixed-menu seller-vault DOV — **not** an arbitrary-payoff composer. Our moat = static replication of *any* defined-risk payoff over binaries/ranges + creator-issued notes + RFQ, built natively on Predict.

**Stack (pinned from SDK research):**
```jsonc
"@mysten/sui": "^2.17.0",
"@mysten/dapp-kit": "^1.0.6",          // legacy line — current code uses this; keep unless migrating
"@mysten/enoki": "^1.0.8",             // ADD
"@cetusprotocol/sui-clmm-sdk": "^1.4.5",   // ADD (NOT the deprecated cetus-sui-clmm-sdk@5.x)
"@pythnetwork/pyth-sui-js": "^3.0.0",  // ADD
"@mysten/walrus": "^1.1.7"             // ADD (or raw HTTP, see P1.4)
```

---

## P0 — Correctness Bugs in "Done" Code (offline, do FIRST)

These are bugs the test suite missed because the asserts were weak. They must be fixed before deploy or the vault misprices shares on-chain.

### P0.1 — Vault NAV must mark the open position (CRITICAL)

**Problem:** `vault.move` `nav()` returns `accounted_assets` (idle cash only). `roll_into_strategy` moves cash into the manager + stores the `StructuredPosition` but never (a) decrements `accounted_assets` by premium spent, nor (b) adds the marked value of the open legs. So `to_shares`/`to_assets` and `crystallize_fee` all run off stale cash-only NAV → deposits/withdrawals during an open epoch misprice shares; HWM fees crystallize on cash moves, not performance.

**Fix:** NAV must be `idle + marked_value(open_position)` where marked value is computed from the live `OracleSVI`. Since Move can't run the TS pricer, mark each leg on-chain using Predict's own `get_trade_amounts`/`get_range_trade_amounts` (the bid side = current redeemable value).

**Files:** `move/sources/vault.move`, `move/tests/vault_tests.move`.

- [x] **V1 safety fix:** deposits and withdrawals cannot reprice shares during an open strategy epoch. `withdraw`, `keeper_roll`, and direct `process_pending` now abort while `strategy_open` or a stored `StructuredPosition` remains.
- [ ] **Step 1: Failing test** — open a strategy in a test vault, then assert `nav(vault, predict, oracle, clock)` ≈ `idle_after_roll + Σ bid_value(leg)`, and that `to_assets(total_shares)` ≈ that NAV (not the stale cash figure). Use the existing Predict test harness pattern from `studio_tests.move`.
- [ ] **Step 2: Run → FAIL** (`nav` signature today takes no oracle/predict).
- [ ] **Step 3: Implement** `marked_position_value<Q>(predict, oracle, pos, clock): u64` that loops the position's legs and sums `predict::get_range_trade_amounts(...).1` (bid×qty) for ranges and `predict::get_trade_amounts(...).1` for binaries; change `nav` to `idle_value + marked_position_value(...)` when `open` is some, else idle. Update `roll_into_strategy` to set `accounted_assets = idle_after + marked_value` at roll time, and re-mark on each NAV read.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5:** Update `to_shares`/`to_assets`/`crystallize_fee` callers to take the oracle-marked NAV. Re-run `donation_does_not_move_share_price` + HWM test to ensure they still pass with the new basis. **Commit** `fix(vault): mark open position into NAV (was cash-only)`.

### P0.2 — Withdraw must respect deployed capital + lock during open epoch

**Problem:** `withdraw` (`vault.move`) takes assets from `idle` only. If capital is in the manager, a large withdraw either aborts (idle too small) or lets an early withdrawer exit at stale NAV ahead of marked losses.

- [ ] **Step 1: Failing test** — roll a strategy, then a withdraw larger than idle should either (a) abort with a clear `EStrategyOpen`/`EInsufficientIdle`, or (b) route through the pending-redemption queue. Pick (a) for v1 (simpler, honest).
- [ ] **Step 2–4:** Add `assert!(!v.strategy_open || assets <= idle_value, EStrategyOpenWithdrawLocked)` (or gate withdrawals to the pending queue while open). Test passes.
- [ ] **Step 5: Commit** `fix(vault): lock/guard withdrawals while a strategy is open`.

### P0.3 — `keeper_roll` is a no-op; make it real or delete it

**Problem:** on-chain `keeper_roll` only flips `strategy_open=false` + `process_pending`; the `KeeperCap.max_budget` check guards nothing (budget unused after assert). Real rolling lives in the TS `buildKeeperRollIntoStrategyTx`.

- [x] **V1 safety fix:** `keeper_roll` no longer pretends to close an open strategy; it aborts if `strategy_open` or a stored `StructuredPosition` remains, and it enforces the pending-asset budget before processing deposits.
- [ ] **Settlement follow-up:** add `keeper_settle` that calls `studio::settle` when `oracle.is_settled()` and clears the stored position before `keeper_roll` can process the next round. Commit `fix(vault): keeper entry actually settles`.

### P0.4 — PT/YT production settlement (plan task 4.2 was never built)

**Problem:** `pt_yt.move` only has `settle_for_testing`; no entry reads `oracle.is_settled()`/`settlement_price` to run the real maturity waterfall (PT redeems floor, YT residual).

- [ ] **Step 1: Failing test** — after a settled oracle, `settle_tranche(...)` pays PT the protected floor and YT the residual, summing to total payout (conservation), with no value leak.
- [ ] **Step 2–4:** Implement `settle_tranche<Q>(&mut TrancheVault, &mut StructuredVault, oracle, clock, ctx)` gated on `oracle.is_settled()`; add `settle` builder to `tranche-client.ts`.
- [ ] **Step 5: Commit** `feat(pt_yt): production maturity settlement + conservation test`.

### P0.5 — `studio_collateral` floor_value is unvalidated input

**Problem:** `open_position` takes `floor_value` as caller-supplied — a curator can over-state the floor and borrow beyond recoverable collateral; no liquidation path.

- [x] **Fix:** bound `floor_value` on-chain against `vault::share_value` for the supplied `Coin<STUDIO_LP>` and reject non-idle vault shares (`strategy_open`, stored open position, or manager cash) until P0.1 marked NAV is implemented. Added `EFloorTooHigh` / `EVaultNotIdle` tests and documented "liquidation-light: borrow ≤ LTV·provable_floor" honestly. Commit `fix(collateral): reject inflated floor values`.

### P0.6 — Code-consistency fixes (from doc/source drift)

- [x] `setup-manager.ts` + `REFERENCE_IMPLEMENTATION.md` call `predict_manager::new` — but the real entry is **`predict::create_manager`** (README:50). Fixed the reference implementation and verified vendored source/event fields (`PredictManagerCreated { manager_id, owner }`).
- [x] `indexer.ts` references dead routes `/prices/latest` + `/history/settlements` (404). Confirmed built code uses only `/oracles` + Sui-RPC; removed the stale dead-route snippets from `REFERENCE_IMPLEMENTATION.md`.
- [x] `predict-client.ts:169` `maxStrike` is a heuristic — read it from the oracle if exposed. Live oracle fields do not expose `max_strike`; `loadOracleState` now prefers future `max_strike` when present and otherwise keeps the heuristic. **Commit** `fix: align manager creation and oracle route assumptions`.

---

## P1 — Turn Scaffolds Into Real Integrations

All four mesh clients import no SDK; two UI panels are static. The research below gives the exact, pinned APIs — use them verbatim.

### P1.1 — Enoki zkLogin + sponsored gas (flagship real-world feature) 🔎VERIFY-FIRST

**Prereqs (human, one-time):** two Enoki Portal keys (portal.enoki.mystenlabs.com) — a **public** key (features `[zkLogin]`, network `[Testnet]`) and a **private** key (features `[Sponsored transactions]`, Testnet). Add Google OAuth Client ID. In Sponsored Transactions, allowlist our package's move-call targets + sender addresses.

**Files:** add `@mysten/enoki`; `app/providers.tsx`, `lib/enoki.ts`, `app/api/sponsor/route.ts`, `app/api/execute/route.ts`, `app/components/MintButton.tsx`.

- [x] **Step 1 — register Enoki wallets before WalletProvider** in `providers.tsx`:

```tsx
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki';
import { useSuiClientContext } from '@mysten/dapp-kit';
function RegisterEnokiWallets() {
  const { client, network } = useSuiClientContext();
  useEffect(() => {
    if (!isEnokiNetwork(network)) return;
    const { unregister } = registerEnokiWallets({
      apiKey: process.env.NEXT_PUBLIC_ENOKI_PUBLIC_KEY!,
      providers: { google: { clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID! } },
      client, network,
    });
    return unregister;
  }, [client, network]);
  return null;
}
// mount <RegisterEnokiWallets/> inside SuiClientProvider, above WalletProvider
```

- [x] **Step 2 — sponsored mint (3-leg round-trip).** Client builds **kind-only** bytes (`tx.build({ client, onlyTransactionKind: true })`), POSTs to `/api/sponsor`, user signs returned bytes, POSTs sig to `/api/execute`. Backend uses `new EnokiClient({ apiKey: process.env.ENOKI_PRIVATE_KEY! })` → `createSponsoredTransaction({ network:'testnet', transactionKindBytes, sender, allowedMoveCallTargets:[`${PKG}::studio::build_and_mint_to_sender`], allowedAddresses:[sender] })` then `executeSponsoredTransaction({ digest, signature })`. (Full code in the SDK-research appendix.)
- [x] **Step 3 —** add a "Sign in with Google" path (filter `useWallets().filter(isEnokiWallet)`, connect the `google` provider) and a "buy gasless" toggle on `MintButton`.
- [ ] **Step 4 —** unit-tested sponsor/execute helpers with a mocked Enoki client; manual testnet smoke remains blocked on Enoki private key + funded manager/tokens. **Commit** `feat(enoki): zkLogin login + sponsored gasless mint`.

> **Gotchas:** never ship the private key client-side; `onlyTransactionKind:true` is mandatory (full build → Enoki rejects); targets must match the Portal allowlist; Enoki wallets are network-bound (re-register on switch).

### P1.2 — Pyth pull-oracle for NAV display + settlement preamble 🔎VERIFY-FIRST

**Files:** add `@pythnetwork/pyth-sui-js`; rewrite `lib/pyth.ts`.

Testnet constants (verify at pyth.network feed-ids#sui-testnet): Hermes `https://hermes-beta.pyth.network`; Pyth state `0x243759059f4c3111179da5878c12f68d612c21a8d54d85edc86164bb18be1c7c`; Wormhole state `0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790`; **BTC/USD feed id** `0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b`.

- [x] **Display path (no tx):** `new SuiPriceServiceConnection('https://hermes-beta.pyth.network').getLatestPriceUpdates([BTC_FEED], { parsed:true })` → `Number(price)*10**expo` for the live NAV/oracle panel. Implemented through `/api/pyth/btc` + React Query; live Hermes probe returned parsed BTC/USD.
- [x] **PTB path (optional, for settlement preamble):** `SuiPythClient(suiClient, pythState, wormholeState).updatePriceFeeds(tx, updateData, [BTC_FEED])` → returns `PriceInfoObject` ids; pay base update fee. Added `buildPythPriceFeedUpdate` wrapper with mocked SDK contract test; not wired to mint/settle because Predict's own oracle is still the settlement source.
- [x] **Commit** `feat(pyth): live BTC price for NAV + optional settlement preamble`.

### P1.3 — Cetus CLMM secondary market for STUDIO_LP 🔎VERIFY-FIRST

**Files:** add `@cetusprotocol/sui-clmm-sdk@^1.4.5`; rewrite `lib/cetus.ts`; wire `VaultMarket.tsx`.

- [x] **Step 1 — VERIFY** the Cetus CLMM package is actually deployed on Sui *testnet* (`CetusClmmSDK.createSDK({ env:'testnet' })` must resolve a package id). Verified through `verifyCetusDeployment`: package `0x5372...2db8`, published_at `0x6bbd...edf7`, sample pool `0xa8b0...d9da`. SDK required an explicit fullnode URL, so `createCetusSdk` now supplies one.
- [x] **Step 2 —** create `STUDIO_LP/dUSDC` pool via `Pool.calculateCreatePoolWithPrice(...)` → `Pool.createPoolWithPricePayload(...)` (price-range API; full snippet in appendix). Added `buildCreateCetusPoolWithPriceTx`; actual pool creation is token/deploy-gated.
- [x] **Step 3 —** `VaultMarket.tsx`: replace the hardcoded 3-vault array with live `VaultClient.readShareValue` + the Cetus secondary price; show **NAV vs secondary** so depositors can exit before expiry. Falls back to generated demo vault fixtures + explicit `mock` secondary label when no `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID` is configured. **Commit** `feat(cetus): STUDIO_LP/dUSDC pool + NAV-vs-secondary in VaultMarket`.

### P1.4 — Walrus self-describing notes (raw HTTP, simplest) 

**Files:** rewrite `lib/walrus.ts`; store `{blobId,hash}` on the position/vault object.

Testnet (free, no wallet): publisher `https://publisher.walrus-testnet.walrus.space`, aggregator `https://aggregator.walrus-testnet.walrus.space`.

- [x] **Store:** `PUT ${PUBLISHER}/v1/blobs?epochs=5` → branch the response: `json.newlyCreated?.blobObject?.blobId ?? json.alreadyCertified?.blobId`. Added `putWalrusJson` + `/api/walrus` POST.
- [x] **Read:** `GET ${AGGREGATOR}/v1/blobs/${blobId}`. Added `getWalrusJson` + `/api/walrus?blobId=...`; UI rendering from a blob remains a P1.5/P2 polish task.
- [x] **Commit** `feat(walrus): store/read self-describing payoff specs (testnet HTTP)`.

> **Gotcha:** mainnet has no free publisher — keep the endpoint in config so the mainnet story is a config flip, not a rewrite.

### P1.5 — Wire the two static UI panels

- [x] **`VaultMarket.tsx`** — done in P1.3 (live NAV + secondary + deposit/withdraw/claim buttons calling `VaultClient`).
- [x] **`TranchePanel.tsx`** — replaced static markup with `TrancheClient` split/merge/redeem actions against configured live vault/share/PT/YT object IDs; shows wallet PT/YT balances and floor setting. **Commit** `feat(ui): wire VaultMarket + TranchePanel to live clients`.

### P1.6 — Test hardening (kill the tautological asserts)

- [ ] Strengthen weak tests flagged in audit: `optimizer.test.ts` assert **sequential > naive strictly** when `utilMult>0` (not `≥0`); `catalog.test.ts` assert **each of the 12 products round-trips to ≤8 legs** via `solveSparse` (plan 6.1); `solver` coherence test assert the certificate's `exactRecovery` matches a known-incoherent vs known-coherent dictionary; `portfolio` assert scenario-grid monotonicity, not just `isFinite`. **Commit** `test: replace tautological asserts with property checks`.

---

## P2 — High-Value Feature Additions (ranked; anti-bloat)

From competitive research. Do in this order; each is independently shippable. **Resist** the cut list (points flywheel, copy-trading, portfolio VaR, any new on-chain primitive — they cost days and the rubric punishes empty/buzzword features).

### P2.1 — NL "describe your view → structured note" AI assistant ★ (top pick, ~3–4d)

**Why #1:** turns an expert-only payoff builder into something a normal user drives — directly the 50% real-world axis and the single best live-demo beat ("type *'BTC stays between 90–110k through Friday'* → renders a fairly-priced range note → one-click buy"). 2025 winners (Magma "AI rebalancing", Floe LendrBot) show judges reward AI-as-coherent-UX. You're a heavy Claude-API user — your wheelhouse.

**Files:** `lib/ai-intent.ts`, `app/api/intent/route.ts`, `app/components/IntentBar.tsx`.

- [ ] **Step 1 — define a constrained payoff DSL** (a JSON schema the existing engine already consumes: `TargetPayoff` regions OR a catalog template + params). The LLM may ONLY emit this schema — so it can never produce an un-replicable (negative) payoff.
- [ ] **Step 2 — `/api/intent`** calls the Anthropic API (`claude-opus-4-8` or `claude-sonnet-4-6`) with a system prompt: "Given a market view + current BTC spot/forward/expiry, output a JSON payoff spec in this schema. Long-only: payoff must be ≥0 everywhere." Use tool-use / structured output to force schema conformance; validate server-side; reject + retry on violation.
- [ ] **Step 3 — `IntentBar.tsx`** above the Builder: free-text in → spec out → feeds the *existing* `solveSparse`/`optimizeBasket` → payoff chart + premium + greeks → one-click mint. Show the natural-language echo ("You're buying: a $90k–$110k range note, max loss = premium $X, max gain $Y").
- [ ] **Step 4 — test** the DSL validator (LLM output → never negative `g`, always ≤8 legs after solve) with recorded fixtures (don't call the live API in CI). **Commit** `feat(ai): natural-language market-view → structured note`.

### P2.2 — Per-note live greeks + payoff/PnL diagram ★ (~2d)

**Why:** cheap technical-axis depth off data you already pull (SVI surface). Sells the "Block-Scholes-powered pricing" story. `greeksUp` already exists in `payoff.ts`.

- [ ] Aggregate basket greeks (Δ/Γ/Vega/Θ) additively across legs (all long → additive); render a per-note panel + the payoff-at-expiry curve with breakevens/max-loss/max-gain marked. **CUT portfolio VaR** (heavy, low demo punch). **Commit** `feat(ui): per-note greeks + payoff diagram`.

### P2.3 — Gasless zkLogin buy-lane PWA (trimmed, ~4–5d)

**Why:** mass-market real-world distribution, newly cheap because Sui shipped gasless stablecoin transfers + zkLogin. **Trim to** a mobile-responsive PWA of the *buy-a-note flow only* (reuse the P2.1 IntentBar + P1.1 Enoki sponsored mint) — **not** a second builder, **not** a native Telegram bot. Ship as a thin consumer lane over the same backend. **Commit** `feat(pwa): gasless mobile buy-a-note lane`.

### P2.4 — Mainnet-migration shim + one Margin composition (~1–2d)

**Why:** the prize literally pays 50% on mainnet deploy, and Predict is testnet-only. A config abstraction that flips all package/object IDs (testnet→mainnet) in one place + a roadmap slide "mainnet-ready the day Predict mainnets" is a direct judging lever most teams fumble. Pair with **one explicit `deepbook_margin` composition** (leverage a note in the same PTB) to satisfy the DeepBook sponsor's "compose deeply" wish — 🔎VERIFY the margin↔predict path exists before committing (prior research found it may not; if it doesn't, drop the Margin leg and keep the shim). **Commit** `feat: mainnet-migration config shim (+ margin compose if available)`.

### P2.5 — Replication↔settlement correctness property test (~1–2d)

**Why:** a DeepBook judge will poke at "does the replicated payoff actually equal the target at settlement?" Add a property test: for random catalog notes + random settlement prices, assert on-chain `settle` payout == `Σ legPays(leg, settlement)·qty` == the target payoff at that price. This defends the technical core. **Commit** `test: replication=payoff correctness property test across settlements`.

**Keep as demo dressing only (≪1d):** the existing creator leaderboard / "featured notes" gallery. No token, no emissions.

---

## P3 — Live / Token-Gated (deploy + prove on testnet) 🔒TOKEN

Blocked on tokens: 5,000 dUSDC (tally.so/r/Xx102L) + ~50 SUI → `0x89c2…338a`. Nothing here can start until tokens land.

- [ ] **P3.1 — `pnpm verify:first`** resolves the remaining unknowns against live testnet: `predict::create_manager` signature + event, `devInspect` return decoding for `get_trade_amounts`, `PredictManager` `store`/`&mut`-in-PTB ability, escrow-backed vault roll. Fix any decoder/signature mismatches found.
- [ ] **P3.2 — `pnpm bench`** (gas-benchmark): stack N `predict::mint` calls vs the 5M compute cap; set the solver's `maxLegs` from the measured safe budget (currently a guess of 8).
- [ ] **P3.3 — deploy** all packages (`deploy.ts`), record `packageId`/`deploy.json`, fill `.env` `NEXT_PUBLIC_*`. Create + fund a `PredictManager` (`setup-manager.ts`), create the share `ShareFactory`/vault.
- [ ] **P3.4 — full e2e + capture tx digests:** create vault → Enoki gasless deposit → roll into an Iron Condor → settle → redeem; record every digest. Validate the escrow-backed roll path live (the one architectural risk). Run `seed-vaults.ts` to create real on-chain demo vaults (currently only writes a JSON fixture).
- [ ] **P3.5 — wire live config** into the mesh integrations (Enoki app-id/allowlist, Pyth BTC object, Cetus pool id, Walrus endpoint) and smoke-test each.

---

## P4 — Demo & Submission

- [ ] **P4.1 — 5-min demo video** hitting the judged beats: problem → solution → **live demo** → why Sui → roadmap. The hero beat = IntentBar (type a view → note → gasless buy). Show: oracle/greeks panel, "same payoff 3 ways" optimizer, mint PTB digest, settle, vault market NAV-vs-secondary, creator leaderboard, backtest.
- [ ] **P4.2 — README + DEMO.md** with deployed `packageId`, live tx digests, the long-only/max-loss invariant, the four technical kernels, and an explicit **mainnet-readiness + Margin-composability** paragraph. Disclose the Umbra UI-shell adaptation. Tag `v1.0-overflow`.
- [ ] **P4.3 — submit to DeepSurge** before June 21 PT, primary track **DeepBook Predict** ($70k pool, least crowded), DeFi secondary.

---

## Execution Order & Effort (≈3 weeks)

| Week | Focus | Items |
|---|---|---|
| **1** | Correctness + tokens in parallel | P0 (all bug fixes, offline) → submit token request day 1 → P3.1–P3.3 the moment tokens land |
| **2** | Real integrations + hero feature | P1 (Enoki/Pyth/Cetus/Walrus + UI wiring) ‖ P2.1 AI assistant ‖ P2.2 greeks |
| **3** | Polish, prove, ship | P2.3 PWA + P2.4 mainnet shim + P2.5 property test → P3.4 live e2e + digests → P4 demo + submit (leave 2-day buffer) |

**Critical path = tokens.** Everything in P0/P1/P2 is offline-doable now; P3 gates the win-half of the prize. Start the token request and P0 today.

## Do-NOT-build (research-justified cuts)
Points/incentive flywheel (no real users in 3 weeks; rubric punishes), copy-trading (cold-start demos as an empty feed), portfolio VaR (heavy, low punch), any *new* on-chain primitive/AMM/perp (competes with the sponsor's own roadmap, won't finish clean). Short-side/written-leg anything (long-only wall). Bluefin/Supra/Switchboard/Seal/closed-loop-Token (no marginal story).

## Self-Review
- **Coverage:** every audit finding (vault NAV bug, withdraw guard, keeper no-op, PT/YT settlement, collateral floor, mesh scaffolds, UI stubs, weak tests, code drift) maps to a P0/P1 task; every ranked feature KEEP maps to a P2 task; all token-gated work is isolated in P3. ✓
- **No placeholders:** SDK calls use pinned versions + exact testnet IDs from research; LLM feature constrained to the existing DSL so it can't emit un-replicable payoffs. ✓
- **Anti-bloat:** cut list explicit and justified. ✓
