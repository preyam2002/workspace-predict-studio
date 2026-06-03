# Predict Studio — Win Plan (rubric-anchored)

> Re-grounded against primary sources on 2026-06-03. This is the *winning* strategy doc (narrative + gaps + what raises score), distinct from the engineering checklist in `2026-05-31-predict-studio-completion.md` and `todo.md`. Read this first.

## The problem statement, verbatim (primary sources)

- **Track:** DeepBook specialized track, **$70k pool** — *"Build trading or liquidity applications powered by DeepBook's on-chain orderbook."* Predict is explicitly in-scope (least-crowded $70k track).
- **Judging is dominated by ONE axis:** Sui's own Overflow Open Lab states *"50% of the score is 'Real-World Application'… how to win on that single axis."* The repeated mantra across the announcement: **"real-world, production-ready apps you can actually use,"** ideally on mainnet. Remaining ~50% splits across product/UX, technical, presentation.
- **Mainnet lever:** *"the 50/50 prize split rewards mainnet deployment by August 27."* Predict is testnet-only, so the win-half is partly a *story* — but the parts that can deploy to mainnet (STUDIO_LP coin, vault accounting, a Spot secondary market) should, and the shim must make it a config flip.
- **Sponsor's composability thesis (this IS our lane):** *"A Predict position composes with other Predict positions, so spreads and structured products become a question of UX, not infrastructure."* Their "what you can build" table maps **"Options (calls, puts, spreads) → Predict (composes natively for spreads)."** We are the canonical realization of that row.
- **The market wedge (bake into every artifact):** *"On-chain options are flat. The entire category sits at $100M TVL. That is not a competitive market, it is an underdeveloped one."* Contrast: Polymarket $7B in Feb 2026 / 70k DAU; Hyperliquid $844M rev; perp DEX volume $7.35T in 2025. **The gap = options are too hard for normal people. We make them one English sentence.**

## Verdict: do we have the features to win?

**Yes on features — arguably too many. The core live proof is done.** The repo has 7 Move modules, ~30 lib modules, 18 UI components, RFQ, PT/YT tranching, collateral, Kiosk, creator economy, cross-margin portfolio, AI, PWA, greeks, backtest — all green offline. As of June 3, 2026, the package is deployed, the PredictManager is funded, a vault/escrow exists, two live mints are captured, and both sample/vault settlement digests are recorded. The remaining 50% risk is Enoki/secondary-market live config plus a focused demo that does not drown the one killer narrative.

## The spine (one sentence the whole submission defends)

> **Type your market view in English → get a fairly-priced, defined-risk structured note, statically replicated as Predict-native legs in one PTB off Block Scholes' own oracle → buy it gasless. Max loss = premium, by construction.**

Everything else (PT/YT, RFQ, collateral, Kiosk, cross-margin) is **depth to mention**, never the spine.

---

## Gap analysis (ranked by rubric weight)

### 50% — Real-World Application  *(our weakest axis; biggest lever)*
- **[DONE] Deployed, minted, and settled.** Package, funded manager, vault, escrow, sample mint, sample settle, vault roll, and vault settle digests are recorded.
- **[DONE] Landing page now leads with the NL front door.** `app/page.tsx` renders `<BuyLane variant="landing" />`; expert `Builder` moved to `/advanced`.
- **[DONE] The $100M-options-gap wedge is now in README/UI copy.** Keep it as the first presentation beat.

### 20% — Product / UX
- **Sprawl.** 18 components compete for the demo's attention. The demo must pick the spine and relegate the rest.
- **"Factory & marketplace" under-shown.** A real consumer loop — *creator packages a view as a note (Walrus spec) → shareable link → friend buys gasless* — is mostly wiring existing pieces (Walrus + buy-lane + creator) and is a genuine distribution mechanic.

### 20% — Technical  *(already strong)*
- 4 research-grade kernels (arb-free SVI repair, NNOMP gas-bounded solver, impact-aware Almgren–Chriss optimizer, replication=payoff property test) — keep, surface.
- **Composability thesis under-dramatized.** Show "this note = N Predict legs in ONE PTB" explicitly — it's the sponsor's exact pitch.
- **DeepBook Spot secondary pool evaluated; not currently fundable.** A DeepBook **Spot permissionless pool** for `STUDIO_LP/dUSDC` is on-thesis, and the active address already has `1999.999999` `STUDIO_LP`; but all six local Sui addresses currently have `0 funded DEEP` and current DeepBook source requires a 500 DEEP pool creation fee. The checker now uses the official SDK testnet registry/package defaults and devInspects `pool::create_permissionless_pool<STUDIO_LP, dUSDC>` once DEEP is present; keep Cetus/mock fallback until funded.
- **[DONE] The killer technical artifact:** on-chain proof path now has real settlement digests: sample settle `3bafswkWphUEzUFkeCvfArhFe78ndcPgvgYoZyrLYCra`, vault settle `7cGNwsGmo2i7wnogcKtf4869a1HrHM6dPiMqH3qMRLqR`.

### 10% — Presentation
- `DEMO.md` and README now include live deploy, mint, sample settlement, and vault settlement digests; the video is still pending.

### Margin — deliberately excluded (defensible, do NOT force)
Verified earlier against `predict-testnet-4-16`: `predict` has zero margin references; `deepbook_margin` routes only to Spot; and Margin is mainnet-only while Predict is testnet-only → no atomic compose exists today. We own the **defined-risk, no-leverage** column ("Options/spreads → Predict composes natively"). Adding leverage would break the clean **max-loss = premium** invariant that is our best story. Mention it as a one-line roadmap item, not a feature.

---

## The plan

### Phase 0 — Unblock (today)
- [x] **Testnet tokens received/used.** 5,000 dUSDC landed and was deposited into the manager. Current local address inventory shows `0.250509634` SUI plus `1999.999999` `STUDIO_LP` on the active address, and another `0.2331732` SUI across two aliases; top up before heavier testing.

### Phase A — Offline ceiling-raisers (no tokens; raise product/technical/presentation NOW)
- [x] **A1 · NL-first landing.** IntentBar is the landing hero; expert `Builder` is behind `/advanced`. Hero copy = the spine sentence. *(50% axis)*
- [x] **A2 · Replication-proof surface.** In-app panel renders exact Predict legs, one-PTB composition, and `payoff == settlement` sampled assertion. Live digest appears after mint. *(20% technical + composability thesis)*
- [x] **A3 · Shareable-note loop.** Share button publishes note specs through `/api/walrus`, embeds blob/hash in a shareable URL, and opens back into `/buy`. *(50% + 20% product)*
- [x] **A4 · (on-thesis, verify-first) DeepBook Spot secondary pool.** Evaluated with `pnpm deepbook:spot-check -- --all-addresses --dry-run`; blocked by missing 500 DEEP creation fee, so Cetus/mock fallback stays until funded. *(20% technical, sponsor alignment)*
- [x] **A5 · Narrative pass.** README includes the $100M-options-gap wedge, spine, kernels, long-only/max-loss invariant, live digests, and mainnet-readiness/Margin paragraph. `DEMO.md` is scaffolded with live proof.
- [x] **A6 · Judge-reading hygiene.** Suite green (118 vitest / 44 Move), no browser automation used, README/DEMO/todo aligned. Final settle/redeem proof is recorded.

### Phase B — Token-gated unlock (the 50%) — *= existing P3, unchanged*
- [x] B1 `verify:first` live · [x] B2 gas bench → real `maxLegs` · [x] B3 deploy + fund manager + create vault/escrow/keeper cap · [x] B4 **full e2e mint→settle→redeem + captured digests** · [ ] B5 wire live config into mesh + smoke (Pyth/Walrus pass; Enoki keys and Cetus/DeepBook pool funding remain).
- [x] **B6 · Fill A2 + README with the REAL digests.** Package/manager/vault/mint/sample-settle/vault-settle digests are recorded.

### Phase C — Presentation (carries the demo)
- [ ] **C1 · 5-min video**, beats timed: problem (the $100M gap) → solution → **live demo** (English view → note → gasless buy → on-chain settle proof; then "same payoff 3 ways," one-PTB composability, NAV-vs-secondary, creator marketplace, backtest) → why Sui → roadmap. Practice 3×.
- [ ] **C2 · Submit to DeepSurge**, DeepBook primary / DeFi secondary, ≥2-day buffer before June 21 PT.

## What NOT to do
No new on-chain primitive, no Margin/leverage leg, no points/copy-trading/VaR. Every offline hour goes to **accessibility, the proof surface, and the narrative** — not more surface area. The score is won by making the existing depth *live, legible, and demonstrated*.
