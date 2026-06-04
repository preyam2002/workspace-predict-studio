# Predict Studio — K2 Completion Plan (Codex Handoff)

> **For the implementing agent (Codex):** This is the authoritative remaining-work plan, superseding the punch-list in `2026-05-31-predict-studio-completion.md` for everything still open. The engine, all 7 Move modules, and the full mesh are BUILT and test-green (**Move 44/44, vitest 125/125**), deployed to testnet with real mint/sample-settle/vault-settle digests. The win is now **(Phase 1)** turning the dormant `studio_collateral.move` into a note-backed lending market — the "K2 collateral fold-in" — and **(Phase 2)** clearing the external submission gates. Do Phase 1 first; it is the new demo spine. Every code step shows the actual symbol or the exact command — no placeholders. Steps that need testnet tokens or a live wallet are tagged **🔒TOKEN**; steps that must confirm an assumption against vendored source before coding are tagged **🔎VERIFY-FIRST**. TDD throughout: failing test → run → implement → green.

**Deadline:** June 21, 2026 Pacific (DeepSurge portal). ~17 days. Prize: DeepBook Predict track $35k first; 50% on win + 50% on mainnet deploy. Judging ≈ **50% real-world / 20% product / 20% technical / 10% presentation**. **One project = one track is confirmed** → Predict Studio enters **DeepBook Predict (primary), DeFi (secondary)**; the K2 fold-in strengthens both without splitting the entry.

**Stack conventions (pinned, already in `package.json`):** Move 2024 (`edition = "2024.beta"`), TypeScript strict, Biome, Vitest, Next.js 16 / React 19, `@mysten/sui ^2.17.0`, `@mysten/dapp-kit ^1.0.6`, `@mysten/enoki ^1.0.8`. Do not introduce ESLint/Prettier or new heavy deps.

---

## ✅ IMPLEMENTATION STATUS (2026-06-05) — Phase 1 core DONE & GREEN (offline)

Implemented directly (not by Codex), **Move 47/47 + vitest 129/129 + `pnpm build` clean**:
- **1.1 getters** — `studio::expiry_ms`, `max_payout_of` (= `max_gain`, the provable ceiling), `provable_floor` (= 0). Test-only `new_for_testing_with_expiry` + `set_settled_for_testing`.
- **1.2 note-backed lending** — `studio_collateral`: `note: Option<StructuredPosition>` field on `BorrowPosition`; `note_collateral_value`, `open_note_position`, `close_note`. Share path + its 4 tests untouched/green. New tests: `borrows_against_note_marked_value_and_reclaims`, `note_borrow_aborts_above_capacity`, `note_borrow_aborts_when_settled`.
- **1.4 one-PTB client** — `CollateralClient.buildMintAndBorrowTx` (build_and_mint → open_note_position → borrow, note piped by handle) + `buildCloseNoteTx`.
- **1.5 UI** — `NoteCollateralPanel.tsx` (self-contained, dapp-kit), wired into `Builder` behind `NEXT_PUBLIC_COLLATERAL_MARKET_ID`; tested capacity math in `lib/note-collateral.ts`. `network-config` gains `collateralMarketId`; `.env.example` documents the var.

**RESOLVED U2 (the soundness fix):** basis is **`min(marked_bid, max_payout)`**, computed **on-chain** from the live oracle in `open_note_position` — NOT the `max_payout`-ceiling-without-liquidation version originally drafted (a long-only note's true floor is 0, so ceiling-basis with no liquidation is undercollateralized). Marked value can't be caller-inflated (read on-chain), is capped by the provable ceiling, and `is_settled` notes are rejected. Honest framing baked into module docs + UI: a **repay-to-reclaim bridge, not leverage**; `max loss = premium` preserved. R2/R4 of §4 are satisfied; the old "floor=0 guarantees recovery" line is void.

**STILL OPEN (token-gated / not yet done):** 1.3 (separate marked variant — moot, folded into 1.2), **1.6** (deploy a shared `CollateralMarket` + `scripts/collateral-demo.ts` live loop + digests — 🔒TOKEN), **1.7** (`collateral_demo` gate in `hackathon-status`). Phase 2 external gates unchanged.

---

## 1 · Objective + the spine

**Objective:** Ship a *note-backed* lending market so a freshly minted `StructuredPosition` is itself collateral, then clear the four external submission gates and submit. MVP = the K2 borrow-against-note loop working on testnet with a captured digest, plus a recorded video and a DeepSurge submission. Everything else is stretch.

**The spine sentence the whole submission now defends:**

> **Type your market view in English → get a fairly-priced, defined-risk structured note, statically replicated as Predict-native legs in one PTB off Block Scholes' own oracle → in the SAME PTB borrow dUSDC against the note's provably-bounded worst-case value → repay and reclaim. Max loss = premium; borrow capacity = a number the chain can prove. Predict Studio is the builder *and* the mini prime-broker for Predict.**

PT/YT, RFQ, Kiosk, creator economy remain **depth to mention**, never the spine. Margin/leverage stays out of scope on purpose (preserves `max loss = premium`).

**Why this is the highest-value remaining work:** ~70% of the code exists. `studio::max_payout(&legs)` already computes the provable ceiling on-chain; `studio::marked_value(predict, oracle, pos, clock)` already returns the live bid-side mark; `StructuredPosition` is already an ownable `key, store` wrapper; `CollateralMarket` / `BorrowPosition` / `collateral-client.ts` already exist. We are wiring an existing lock-and-borrow market onto an existing provable-floor primitive — not building a new primitive.

**Why it can't be a standalone project:** Predict positions are **non-transferable** (owner-bound rows inside `PredictManager`). The only collateralizable object is the `StructuredPosition` wrapper Predict Studio mints. So "borrow against a Predict position" has no standalone surface — it *is* Predict Studio.

---

## 2 · Verify-first unknowns (confirm on Day 1, before writing Phase 1 code) 🔎VERIFY-FIRST

Resolve each by reading vendored source under `move/build/predict_studio/sources/dependencies/deepbook_predict/` and the studio modules. Record findings inline in this file (append a `> CONFIRMED:` / `> ADJUSTED:` line under each). Do **not** start coding a task until its prerequisites here are confirmed.

- [ ] **U1 — Is the provable floor exposed and callable from `studio_collateral`?**
  `studio::max_payout(legs: &vector<Leg>): u64` is `public fun` (confirmed in `move/sources/studio.move:336`). But `studio_collateral` will hold a *`StructuredPosition`*, not a bare `vector<Leg>`. There is **no** public getter returning the legs vector or `max_payout` *from a position*. Confirm and then **add** `public fun max_payout_of(pos: &StructuredPosition): u64` (returns `self.max_gain`, which is set to `max_payout(&legs)` at mint — `studio.move:179,189`) and/or `public fun provable_floor(pos: &StructuredPosition): u64` (long-only floor = `0`). Acceptance for U1: a one-line getter compiles and a unit test asserts `max_payout_of(pos) == max_gain(pos)`.

- [ ] **U2 — What exactly does "marked-NAV settlement" need for collateral?**
  `studio::marked_value(predict, oracle, pos, clock): u64` exists (`studio.move:110`) and sums bid-side `get_trade_amounts` / `get_range_trade_amounts`. Confirm it is `public fun` and callable from `studio_collateral` (it is `public`). Decide the collateral-valuation basis (see Risks R2):
  - **Conservative (MVP):** value the note at its **bounded worst-case floor = 0** is too strict to borrow against, so use the **provable ceiling** `max_payout_of(pos)` as the collateral basis and a low LTV (e.g. 3000–5000 bps). This needs **no oracle** and cannot be gamed by SVI movement — the strongest "the chain can prove it" story.
  - **Marked (stretch):** value at `min(marked_value(...), max_payout_of(pos))` so capacity tracks live redeemable value, capped by the provable ceiling. Requires threading `&Predict`, `&OracleSVI`, `&Clock` into `open_position`/`borrow`.
  Acceptance for U2: a written decision recorded here naming the basis, plus the borrow-capacity formula.

- [ ] **U3 — Does `StructuredPosition` carry enough to value a note and bind it to a borrower?**
  Confirm the position exposes (all already present in `studio.move`): `owner()`, `manager_id()`, `oracle_id()`, `max_gain()`, `premium_paid()`, `is_settled()`, `leg_count()`. Confirm `key, store` ability (it is — `studio.move:40`) so it can be `option::fill`ed into the market. Missing piece to verify: there is **no** getter for `expiry_ms`; add `public fun expiry_ms(self: &StructuredPosition): u64` if the collateral market needs to reject already-expired notes. Acceptance for U3: list of getters used by `studio_collateral` all exist or are added.

- [ ] **U4 — Lock semantics: hold the position, or hold a claim?**
  Today `open_position` joins a `Coin<STUDIO_LP>` into `locked_collateral: Balance<STUDIO_LP>`. A `StructuredPosition` is a single object, not a `Balance`, so the market struct needs a new field (e.g. `notes: ObjectTable<ID, StructuredPosition>` or, simplest for MVP, store the position inside the `BorrowPosition` via `Option<StructuredPosition>`). Confirm the simplest path that keeps one borrow = one note. Acceptance for U4: chosen storage shape recorded; it must let `close` return the *exact same* note object to the owner.

- [ ] **U5 — Can the whole loop run atomically in one PTB?**
  Confirm `build_and_mint` returns an owned `StructuredPosition` value (it does — `studio.move:141`) that a PTB can pass directly into a new `open_note_position` move-call without an intervening transfer. Acceptance for U5: a TS test in `lib/` builds a single `Transaction` chaining `studio::build_and_mint` → `studio_collateral::open_note_position` → `studio_collateral::borrow` and the move-call result wiring type-checks (dry-run optional at this step).

- [ ] **U6 — Settlement-after-borrow safety.**
  A borrower could let the note settle while debt is open. Confirm whether `studio::settle` can be called on a position the market holds (it requires `sender == pos.owner` and `sender == manager.owner` — `studio.move:281`). Decide policy: forbid borrowing past expiry, and on `close`/liquidate require `debt == 0`. Acceptance for U6: a written rule + a test that borrowing on an already-settled note aborts.

---

## 3 · Phased atomic tasks

### Phase 1 — K2 collateral fold-in (the MVP centerpiece)

All Move changes are TDD. Verification command for every Move step: `sui move test -p move` (must stay green; new tests must fail first). For TS: `pnpm test`. Lint/format gate before any commit: `pnpm exec biome check --write .` (or the repo's configured Biome script) and `pnpm build`.

#### 1.1 — Expose the provable floor on a position (depends: U1, U3)

**Files:** `move/sources/studio.move`, `move/tests/studio_tests.move`.

- [ ] **Step 1 (failing test):** in `studio_tests.move`, build a position via `new_for_testing` with known range legs; assert `studio::max_payout_of(&pos) == studio::max_gain(&pos)` and `studio::provable_floor(&pos) == 0`. Add an `expiry_ms` getter assertion.
- [ ] **Step 2:** `sui move test -p move` → FAIL (symbols don't exist).
- [ ] **Step 3 (implement):** add `public fun max_payout_of(self: &StructuredPosition): u64 { self.max_gain }`, `public fun provable_floor(_self: &StructuredPosition): u64 { 0 }` (long-only guaranteed floor), and `public fun expiry_ms(self: &StructuredPosition): u64 { self.expiry_ms }`.
- [ ] **Step 4:** `sui move test -p move` → PASS.
- [ ] **Acceptance Criterion:** `max_payout_of`, `provable_floor`, `expiry_ms` are public getters; test asserts equality with `max_gain`/floor=0. **Verify:** `sui move test -p move` green; new test present.
- [ ] **Commit:** `feat(studio): expose provable floor + payout/expiry getters on StructuredPosition`.

#### 1.2 — Note-backed lending market in `studio_collateral.move` (depends: U2, U4, U5, U6)

**Files:** `move/sources/studio_collateral.move`, `move/tests/studio_collateral_tests.move`.

This is the core change. **Keep the existing share-collateral API working** (don't break the 4 existing collateral tests); add a parallel note-collateral path so nothing regresses.

- [ ] **Step 1 (failing tests)** in `studio_collateral_tests.move`:
  - `borrows_against_note_floor_and_reclaims_after_repay`: mint/construct a `StructuredPosition` (`studio::new_for_testing` with a bounded range basket whose `max_payout` is known, e.g. `1_000_000`), open a note position into a market with `ltv_bps = 5_000`, assert `note_borrow_capacity(position, market) == max_payout_of(note) * 5_000 / 10_000`, borrow under capacity, repay, then `close_note` returns a position whose `object::id` equals the original.
  - `note_borrow_aborts_above_capacity` (`expected_failure(abort_code = EExceedsCapacity)`).
  - `note_borrow_aborts_when_settled` (`expected_failure`) — borrowing on a settled note aborts (U6).
- [ ] **Step 2:** `sui move test -p move` → FAIL.
- [ ] **Step 3 (implement):**
  - Add a field to `CollateralMarket` to hold notes per borrow. MVP shape: store the note inside `BorrowPosition` via `Option<StructuredPosition>` (chosen in U4), and add `note_floor: u64` to `BorrowPosition`.
  - `public fun open_note_position(market: &mut CollateralMarket, note: StructuredPosition, ctx: &mut TxContext): BorrowPosition` — asserts `!studio::is_settled(&note)` (U6) and `studio::owner(&note) == tx_context::sender(ctx)`; sets `note_floor = studio::max_payout_of(&note)` (the provable ceiling basis chosen in U2-conservative); `option::fill`s the note; returns a `BorrowPosition` with `collateral_shares = 0`, `floor_value = note_floor`.
  - `public fun note_borrow_capacity(position, market): u64 { position.floor_value * market.ltv_bps / BPS }` (reuse existing `borrow_capacity` if the field shape lines up — prefer reusing `borrow`/`repay` unchanged).
  - `public fun close_note(market, position, ctx): StructuredPosition` — asserts `debt == 0`, `sender == owner`, `option::extract`s and returns the note.
  - Reuse the existing `borrow` / `repay` for the dUSDC side (debt accounting is identical). Add error consts as needed (`ENoteSettled`, `ENoteNotOwner`) and document the floor basis in a module doc-comment.
- [ ] **Step 4:** `sui move test -p move` → PASS; all 4 pre-existing collateral tests still pass.
- [ ] **Acceptance Criterion:** A note can be locked, borrowed against up to `LTV * max_payout`, repaid, and reclaimed as the identical object; borrowing above capacity or on a settled note aborts; share-collateral path untouched. **Verify:** `sui move test -p move` green (count rises from 44).
- [ ] **Commit:** `feat(collateral): lend dUSDC against StructuredPosition notes capped at provable max_payout`.

#### 1.3 — Marked-NAV settlement so open/non-idle notes are eligible (depends: U2 — stretch within Phase 1)

**Files:** `move/sources/studio_collateral.move` (+ `vault.move` only if the share-path rejection must change), `move/tests/studio_collateral_tests.move`.

The existing share path rejects non-idle vaults (`EVaultNotIdle`, `studio_collateral.move:71`). The note path doesn't touch vault idleness at all — a note is collateral regardless of vault state — so **MVP needs no `vault.move` change**. This task only applies if pursuing the marked basis (U2-stretch):

- [ ] **Step 1 (failing test):** value a held note by `min(marked_value(...), max_payout_of(...))` and assert capacity tracks the marked bid when the bid < ceiling. Requires a Predict+OracleSVI test harness (reuse the one already used by `vault_tests.move` for `marked_value`).
- [ ] **Step 2–4:** add `open_note_position_marked(market, note, predict, oracle, clock, ctx)` and a `note_borrow_capacity_marked(...)` that recomputes against the live bid, capped by `max_payout_of`. Keep the conservative path as the default.
- [ ] **Acceptance Criterion:** marked capacity ≤ ceiling capacity always; never exceeds `max_payout`. **Verify:** `sui move test -p move` green.
- [ ] **Commit:** `feat(collateral): optional marked-NAV note valuation capped by provable ceiling`.
- [ ] **MVP/stretch:** **Stretch.** Ship 1.2 (conservative ceiling basis) for the MVP; 1.3 only if Move time remains.

#### 1.4 — Borrow-against-note PTB (TS client) (depends: U5)

**Files:** `lib/collateral-client.ts`, `lib/collateral-client.test.ts`.

- [ ] **Step 1 (failing test):** in `collateral-client.test.ts`, assert a new `buildMintAndBorrowTx(...)` returns one `Transaction` whose serialized move-calls are, in order: `studio::build_and_mint`, `studio_collateral::open_note_position`, `studio_collateral::borrow`, and transfers the borrowed dUSDC + the eventual close path. Assert the note result of `build_and_mint` is piped (by tx result handle) into `open_note_position` (no intermediate `transferObjects` of the note).
- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3 (implement):** add `buildOpenNotePositionTx`, `buildCloseNoteTx`, and the composed `buildMintAndBorrowTx({ predictArgs, marketId, borrowAmount, recipient })` to `CollateralClient`, mirroring the existing `buildOpenPositionTx`/`buildBorrowTx` style. Use `tx.moveCall` result handles to chain mint → open → borrow in one PTB.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Acceptance Criterion:** one PTB builder chains mint→lock→borrow with the note never leaving the PTB; unit test green. **Verify:** `pnpm test`.
- [ ] **Commit:** `feat(collateral-client): one-PTB mint→lock-note→borrow + close builders`.

#### 1.5 — UI panel: "Borrow against this note" (depends: 1.2, 1.4)

**Files:** new `app/components/NoteCollateralPanel.tsx`; wire into the note view next to `ReplicationProofPanel.tsx` / `MintButton.tsx`.

- [ ] **Step 1:** add `NoteCollateralPanel` (functional component, `const` arrow, Tailwind, no class components). It shows: the note's `max_payout` provable floor, current LTV, computed borrow capacity, a "Mint + Borrow in one transaction" button calling `buildMintAndBorrowTx`, and Repay/Reclaim actions. Read live `CollateralMarket` liquidity via a thin client read (reuse `CollateralClient`/devInspect; if a read helper is missing, add `readMarket(marketId)`).
- [ ] **Step 2:** render it on the main note flow behind the existing config gate (only when `NEXT_PUBLIC_COLLATERAL_MARKET_ID` is set; document this var in `.env.example`). Falls back to a disabled "configure a collateral market" state when unset — mirror the `mock`-label pattern used by `VaultMarket.tsx`.
- [ ] **Acceptance Criterion:** panel renders capacity + buttons; `pnpm build` and `pnpm test` green; no Biome errors. **Verify:** `pnpm build` && `pnpm exec biome check .`.
- [ ] **Commit:** `feat(ui): borrow-against-note collateral panel`.

#### 1.6 — Deploy + live K2 demo beat 🔒TOKEN (depends: 1.2–1.5)

**Files:** `scripts/deploy.ts` (ensure it shares a `CollateralMarket`), new `scripts/collateral-demo.ts` + `pnpm collateral:demo` script in `package.json`, update `docs/DEMO.md` (the timed script already exists — only add the borrow beat + digests), `README.md` Live Testnet Proof block.

- [ ] **Step 1:** confirm `deploy.ts` creates and shares a `CollateralMarket` (LTV e.g. 5000 bps) and seeds it with dUSDC liquidity; if not, add it. Record `collateralMarketId` to `deploy.json` and `.env.example` as `NEXT_PUBLIC_COLLATERAL_MARKET_ID`.
- [ ] **Step 2:** write `scripts/collateral-demo.ts` that runs the live loop on testnet: build a small defined-risk note → in one PTB lock it + borrow a fraction of capacity → print borrow digest → repay → reclaim → print reclaim digest. Mirror the digest-capture style of `settle-sample.ts`/`live-proof.ts`.
- [ ] **Step 3:** run `pnpm collateral:demo -- --execute` once funded; capture `borrow digest`, `repay digest`, `reclaim digest`; paste into `README.md` + `docs/DEMO.md`. Add a `collateral:demo` proof line to `pnpm live:proof`.
- [ ] **Acceptance Criterion:** a real testnet borrow-against-note round-trip with three captured digests is recorded in README + DEMO.md, and `pnpm live:proof` prints them. **Verify:** `pnpm live:proof`; `sui client tx-block <borrow digest>` resolves on testnet.
- [ ] **MVP/stretch:** **MVP.** This beat is the new demo climax; it must be live before recording.
- [ ] **Commit:** `feat(demo): live mint→borrow→repay→reclaim collateral loop + digests`.

#### 1.7 — Fold the K2 beat into status gates

**Files:** `scripts/hackathon-status.ts`, `lib/hackathon-status.ts` (+ its `.test.ts`), `scripts/demo-evidence.ts`.

- [ ] Add a `collateral_demo` gate to `pnpm hackathon:status` that passes when the three K2 digests are present in `deploy.json` (mirror the sample/vault-settlement gates). Update `lib/hackathon-status.test.ts` fixtures. Add the K2 digests to the `pnpm demo:evidence` bundle.
- [ ] **Acceptance Criterion:** `pnpm hackathon:status` reports the new gate; `pnpm test` green. **Verify:** `pnpm test` && `pnpm hackathon:status`.
- [ ] **Commit:** `feat(status): K2 collateral-loop readiness gate`.

### Phase 2 — External submission gates

These are the only things blocking submission once Phase 1 is live. Several need a human (keys, tokens, recording, portal). Codex should drive everything up to the human handoff and leave a crisp checklist.

#### 2.1 — Enoki gasless lane live smoke 🔒TOKEN / human-key

- [ ] **Codex-doable:** confirm `app/api/sponsor`, `app/api/execute`, `lib/enoki-server.ts`, and `providers.tsx` Enoki registration are wired (they are — P1.1 done); ensure the move-call allowlist includes `studio::build_and_mint_to_sender` **and** the new `studio_collateral::open_note_position` + `borrow` targets if the gasless lane should sponsor the borrow loop.
- [ ] **Human gate:** set `NEXT_PUBLIC_ENOKI_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `ENOKI_PRIVATE_KEY`; allowlist targets + sender in the Enoki Portal; run one live `/buy` gasless mint.
- [ ] **Acceptance Criterion:** `pnpm hackathon:status` Enoki gate flips to pass; one gasless digest captured. **Verify:** `pnpm hackathon:status`.

#### 2.2 — Secondary market path 🔒TOKEN / human-token

- [ ] **Codex-doable:** keep the DeepBook Spot dry-run + Cetus fallback exactly as built (`pnpm deepbook:spot-check -- --all-addresses --dry-run`); ensure the gate passes with either `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID` or a funded DeepBook path.
- [ ] **Human gate:** acquire **500 DEEP** for the DeepBook Spot permissionless pool, OR create a Cetus `STUDIO_LP/dUSDC` pool and set `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID`.
- [ ] **Acceptance Criterion:** secondary-market gate passes. **Verify:** `pnpm hackathon:status`.

#### 2.3 — Record the 5-minute demo video (human)

- [ ] Use the existing timed script in `docs/DEMO.md`, **adding the K2 beat** as the depth climax: "build a defined-risk note → in the same transaction borrow dUSDC against its provable floor → repay → reclaim — a builder *and* a prime-broker." Run `pnpm verify:first · pnpm live:proof · pnpm hackathon:status · pnpm collateral:demo · pnpm dev` before recording.
- [ ] **Human gate:** record, upload, set `DEMO_VIDEO_URL`.
- [ ] **Acceptance Criterion:** demo-video gate passes. **Verify:** `pnpm hackathon:status`.

#### 2.4 — Submit to DeepSurge (human)

- [ ] **Codex-doable:** `pnpm submission:check` green (regenerate `docs/SUBMISSION.md` with the K2 digests + the prime-broker framing; keep the Umbra UI-shell disclosure and the Margin-out-of-scope paragraph). `pnpm demo:evidence` refreshed.
- [ ] **Human gate:** submit on DeepSurge (DeepBook primary / DeFi secondary) with ≥2-day buffer; set `DEEPSURGE_SUBMISSION_URL`; tag `v1.0-overflow`.
- [ ] **Acceptance Criterion:** `pnpm hackathon:status` reports `hackathon_ready=true`. **Verify:** `pnpm hackathon:status`.

---

## 4 · Risks & gotchas

- **R1 — Non-transferable Predict positions.** The Predict legs live as owner-bound rows in `PredictManager`; only the `StructuredPosition` wrapper is ownable. The collateral market must lock the *wrapper*, and `close_note` must hand back the *identical* wrapper object (assert `object::id` round-trips in tests). Never attempt to move the underlying legs.
- **R2 — Marked-NAV correctness / don't over-credit collateral.** The provable, ungameable basis is `max_payout_of(pos)` (a long-only basket pays in `[0, max_payout]` with no oracle dependency). If you use `marked_value` (live bid), it can swing with the SVI surface and could over-credit at a local high — so always cap marked at `max_payout_of` and prefer the conservative ceiling basis for MVP. Borrow capacity must never exceed `LTV * max_payout`. State the basis in the module doc-comment and the demo narration.
- **R3 — Don't break `max loss = premium`.** The note's max loss is still the premium paid; borrowing dUSDC against it does **not** add leverage to the position — it's a loan secured by a bounded asset, repayable to reclaim. Do **not** introduce margin, short legs, or any path that lets loss exceed premium. Margin remains a one-line roadmap item only.
- **R4 — Settlement-after-borrow.** Forbid opening a note position on a settled note (U6) and forbid `close_note`/reclaim while `debt > 0`. A liquidation path is explicitly out of scope for MVP ("liquidation-light: borrow ≤ LTV·provable_floor, floor=0 guarantees recovery"); document this honestly as the existing collateral module already does.
- **R5 — Regression surface.** The share-collateral path and its 4 tests must stay green; add the note path in parallel rather than refactoring the share path. Keep `sui move test -p move` and `pnpm test` green at every commit.
- **R6 — Scope creep.** Resist building a generic money-market (interest accrual, oracle-priced liquidations, multi-asset). MVP is one note = one borrow, fixed LTV, manual repay. The win is the *composable demo*, not a lending protocol.
- **R7 — External-gate latency.** Enoki keys, 500 DEEP, and the video are human-blocked and can't be rushed at the end. Open those requests on Day 1 in parallel with Phase 1 coding.

---

## 5 · Definition of Done

**MVP (must-have for submission):**
- [ ] Move: `max_payout_of` / `provable_floor` / `expiry_ms` getters + note-backed `open_note_position` / `close_note` lending path; `sui move test -p move` green with new tests (count > 44).
- [ ] TS: `buildMintAndBorrowTx` one-PTB builder + close builder; `pnpm test` green (count > 125).
- [ ] UI: `NoteCollateralPanel` rendering borrow capacity + mint→borrow / repay / reclaim, gated on config; `pnpm build` clean.
- [ ] Live: a real testnet **mint→borrow→repay→reclaim** round-trip with three captured digests in `README.md` + `docs/DEMO.md`; `pnpm live:proof` prints them; `pnpm hackathon:status` shows the K2 gate.
- [ ] Submission: video recorded with the K2 beat (`DEMO_VIDEO_URL` set); DeepSurge submitted (`DEEPSURGE_SUBMISSION_URL` set); at least one secondary-market path and the Enoki gate satisfied; `pnpm hackathon:status` → `hackathon_ready=true`; tagged `v1.0-overflow`.
- [ ] Invariants intact: `max loss = premium`; borrow capacity ≤ `LTV * max_payout`; share-collateral path and all prior tests still green; **no margin code added**.

**Stretch (only if time remains in ~17 days):**
- [ ] Marked-NAV note valuation (1.3) capped by the provable ceiling.
- [ ] Gasless lane sponsors the borrow loop (Enoki allowlist includes the collateral targets).
- [ ] A read helper surfacing live `CollateralMarket` liquidity/utilization in the UI.

**Explicitly NOT in scope:** margin/leverage, interest accrual, oracle-priced liquidations, multi-asset collateral, any new on-chain primitive, copy-trading/points/VaR. The score is won by making existing depth *live, legible, and demonstrated* — now with the prime-broker beat on top.
