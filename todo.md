# Predict Studio — Road to Sui Overflow 2026 Submission

**Deadline:** June 21, 2026 (Pacific) · Portal: DeepSurge · Primary track: **DeepBook Predict** ($70k pool, least crowded) · Prize: $35k first, **50% on win + 50% on mainnet deploy**.

**One-liner pitch:** *The structured-note factory & marketplace on DeepBook Predict — describe your market view in English, get a fairly-priced defined-risk note, buy it gasless.*

**Current state (2026-05-31):** Offline build complete and test-green (Move 40/40, vitest passing, tsc + next build clean). Engine, all Move modules, mesh integrations, and the AI front-door are coded. **The gate to winning is now testnet tokens → live deploy → demo.** Detailed specs live in `docs/superpowers/plans/2026-05-31-predict-studio-completion.md`.

---

## 🔴 CRITICAL PATH — do these or there is no submission

- [ ] **Get testnet tokens** (blocks everything live): submit dUSDC request at tally.so/r/Xx102L (5,000 dUSDC) + fund ~50 SUI to `0x89c2be87d2a3db2ad43f13a5b989868529c43f5d43ddad6ece3089f17df5338a`. **Do this TODAY** — it's a queue.
- [ ] **Deploy to testnet** once tokens land (`pnpm deploy`), record `packageId` + fill `.env` `NEXT_PUBLIC_*`.
- [ ] **One real mint→settle→redeem on testnet** with captured tx digests. The moment this works, the project is "real."
- [ ] **5-minute demo video** (problem → solution → live demo → why Sui → roadmap).
- [ ] **Submit to DeepSurge** before June 21 PT with 2-day buffer.

---

## P0 — Correctness (finish the bug fixes) · offline

Safety fixes landed (commits `54b6bba`, `9ffa197`, `66783ca`, collateral floor, `create_manager`). Remaining:
- [ ] **Full oracle-marked NAV** (P0.1 steps 3–5): `nav = idle + Σ bid_value(open legs)` via `predict::get_trade_amounts`, not cash-only. The deposit/withdraw lock is a band-aid; this is the real fix. Needed before vault demo is honest.
- [ ] **PT/YT production settlement** (P0.4): real `settle_tranche` reading `oracle.is_settled()` (only `settle_for_testing` exists today) + conservation test.
- [ ] **`keeper_settle`** follow-up: on-chain settle when oracle settled, clear position before next roll.
- [ ] Re-run `donation` + HWM tests against the new marked-NAV basis.

## P1 — Integrations: scaffold → REAL · mostly coded, NEEDS LIVE VERIFICATION

Commits landed for all four; each still needs a live testnet smoke test + real config:
- [x] Enoki zkLogin wallet registration + sponsored gasless mint (`7e71ef8`, `c0a267c`) — [ ] **verify live:** provision 2 Portal keys (public client / private backend), Google OAuth client, allowlist `studio::build_and_mint_to_sender`.
- [x] Pyth live BTC NAV anchor (`50b91a0`) — [ ] **verify live:** confirm testnet BTC/USD feed `0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b` + hermes-beta returns price.
- [x] Cetus STUDIO_LP/dUSDC secondary market (`be3ea95`) — [ ] **verify live:** confirm Cetus CLMM package is actually deployed on Sui **testnet** (it may not be — fall back to a labeled mock panel if absent).
- [x] Walrus note-spec storage (`66783ca`) — [ ] **verify live:** PUT/GET against `publisher/aggregator.walrus-testnet.walrus.space`.
- [x] VaultMarket + TranchePanel wired to clients (`33e3226`) — [ ] click-through with a real wallet.
- [x] Test hardening (`819d11a`).
- [ ] **Code-drift cleanup:** confirm `setup-manager.ts` uses `predict::create_manager`; delete dead indexer routes; read `maxStrike` from oracle not heuristic.

## P2 — High-value features (anti-bloat, ranked) · partly done

- [x] **#1 NL "describe view → structured note" AI assistant** (`1bdf31b`) — [ ] polish the demo copy + guard rails (LLM output constrained to DSL, never negative `g`, ≤8 legs). **This is the hero demo beat.**
- [ ] **#2 Per-note greeks + payoff/PnL diagram** (~2d): aggregate Δ/Γ/Vega/Θ off the SVI surface (`greeksUp` exists). Cheap technical-axis depth.
- [ ] **#3 Gasless zkLogin buy-lane PWA** (~4–5d, trimmed): mobile-responsive buy-a-note flow only, reusing IntentBar + Enoki sponsor. Not a second builder.
- [ ] **#4 Mainnet-migration shim + 1 Margin composition** (~1–2d): config flip testnet→mainnet (targets the 50% mainnet prize) + one `deepbook_margin` compose if the path exists (verify first).
- [ ] **#5 Replication = payoff settlement property test** (~1–2d): random notes × random settlement → on-chain payout == target payoff. Defends the technical core.
- **CUT (do not build):** points flywheel, copy-trading, portfolio VaR, any new on-chain primitive. Keep only the creator leaderboard as demo dressing.

## P3 — Live / token-gated · blocked on tokens

- [ ] `pnpm verify:first` — resolve remaining unknowns live (`create_manager` sig/event, `devInspect` decoding, escrow-backed roll, manager `&mut`-in-PTB).
- [ ] `pnpm bench` — gas benchmark vs 5M cap → set solver `maxLegs` from the measured budget (currently guessed at 8).
- [ ] Deploy all packages; create + fund a `PredictManager`; create a vault; `seed-vaults.ts` for real on-chain demo vaults.
- [ ] Full e2e: vault → gasless deposit → roll Iron Condor → settle → redeem; record all digests. Validate the escrow-backed roll path (the one architectural risk).
- [ ] Wire live config into all 4 mesh integrations + smoke-test.

## P4 — Demo & submission

- [ ] 5-min video: hero beat = type a market view → note → gasless buy. Show optimizer "same payoff 3 ways", mint digest, settle, vault NAV-vs-secondary, backtest.
- [ ] README + DEMO.md with `packageId`, live tx digests, the long-only/max-loss invariant, the 4 technical kernels, **explicit mainnet-readiness + Margin-composability paragraph**. Disclose Umbra UI-shell adaptation. Tag `v1.0-overflow`.
- [ ] Submit to DeepSurge (DeepBook primary, DeFi secondary).

---

## Weekly cadence (≈3 weeks)

| Week | Focus |
|---|---|
| **1 (now)** | Request tokens **today** · finish P0 marked-NAV + PT/YT settlement · deploy + first live mint the moment tokens arrive (P3.1–P3.3) |
| **2** | Live-verify all P1 integrations · P2.2 greeks · polish P2.1 AI assistant · P2.4 mainnet shim |
| **3** | P2.3 PWA · P2.5 property test · P3.4 full e2e + digests · P4 video + README · submit (2-day buffer) |

**Critical-path reminder:** everything in P0/P1/P2 is offline-doable now; **P3 unlocks the win-half of the prize and is gated only on tokens.** Submit the token request first.
