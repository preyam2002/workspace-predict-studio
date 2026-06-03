# Predict Studio — Road to Sui Overflow 2026 Submission

**Deadline:** June 21, 2026 (Pacific) · Portal: DeepSurge · Primary track: **DeepBook Predict** ($70k pool, least crowded) · Prize: $35k first, **50% on win + 50% on mainnet deploy**.

**One-liner pitch:** *The structured-note factory & marketplace on DeepBook Predict — describe your market view in English, get a fairly-priced defined-risk note, buy it gasless.*

**Current state (2026-06-01):** Offline build complete and test-green (Move 44/44, vitest 93/93, tsc + next build clean). Engine, all Move modules, mesh integrations, AI front-door, greeks/payoff analytics, mobile buy-lane PWA, mainnet config shim, and replication property tests are coded. **The gate to winning is now testnet tokens → live deploy → demo.** Detailed specs live in `docs/superpowers/plans/2026-05-31-predict-studio-completion.md`.

---

## 🔴 CRITICAL PATH — do these or there is no submission

- [ ] **Get testnet tokens** (blocks everything live): submit dUSDC request at tally.so/r/Xx102L (5,000 dUSDC) + fund ~50 SUI to `0x89c2be87d2a3db2ad43f13a5b989868529c43f5d43ddad6ece3089f17df5338a`. **Do this TODAY** — it's a queue.
- [ ] **Deploy to testnet** once tokens land (`pnpm deploy`), record `packageId` + fill `.env` `NEXT_PUBLIC_*`.
- [ ] **One real mint→settle→redeem on testnet** with captured tx digests. The moment this works, the project is "real."
- [ ] **5-minute demo video** (problem → solution → live demo → why Sui → roadmap).
- [ ] **Submit to DeepSurge** before June 21 PT with 2-day buffer.

---

## P0 — Correctness · offline

Safety fixes landed (commits `54b6bba`, `9ffa197`, `66783ca`, collateral floor, `create_manager`). Correctness pass now complete locally:
- [x] **Full oracle-marked NAV** (P0.1 steps 3–5): `nav = accounted cash + Σ bid_value(open legs)` via `predict::get_trade_amounts` / `get_range_trade_amounts`, not cash-only.
- [x] **PT/YT production settlement** (P0.4): real `settle_tranche` gated on `oracle.is_settled()` + conservation test.
- [x] **`keeper_settle`** follow-up: on-chain settle when oracle settled, clear position before next roll.
- [x] Re-run `donation` + HWM tests against the new marked-NAV basis.

## P1 — Integrations: scaffold → REAL · mostly coded, partly live-verified

Commits landed for all four; each still needs a live testnet smoke test + real config:
- [x] Enoki zkLogin wallet registration + sponsored gasless mint (`7e71ef8`, `c0a267c`) — [ ] **verify live:** provision 2 Portal keys (public client / private backend), Google OAuth client, allowlist `studio::build_and_mint_to_sender`.
- [x] Pyth live BTC NAV anchor (`50b91a0`) — [x] **verify live:** Hermes BTC/USD feed `0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b` returned a fresh parsed price.
- [x] Cetus STUDIO_LP/dUSDC secondary market (`be3ea95`) — [x] **verify live:** Cetus CLMM is deployed on Sui testnet (`0x5372...2db8`, sample pool `0xa8b0...d9da`).
- [x] Walrus note-spec storage (`66783ca`) — [x] **verify live:** PUT/GET round-tripped blob `BMyqzjaNLWUYqnJ8BPmvtA_nluACEzsolV3bmI7fGb8`.
- [x] VaultMarket + TranchePanel wired to clients (`33e3226`) — [ ] click-through with a real wallet.
- [x] Test hardening (`819d11a`).
- [x] **Code-drift cleanup:** `setup-manager.ts` uses `predict::create_manager`; dead indexer route assumptions removed from code; `maxStrike` prefers oracle `max_strike` when exposed.

## P2 — High-value features (anti-bloat, ranked) · partly done

- [x] **#1 NL "describe view → structured note" AI assistant** (`1bdf31b`): demo copy now includes premium/max-loss/max-gain, and server guard rails force non-negative `g` + ≤8-leg replication.
- [x] **#2 Per-note greeks + payoff/PnL diagram:** aggregate Δ/Γ/Vega/Θ off the SVI surface and render payoff extrema/breakevens.
- [x] **#3 Gasless zkLogin buy-lane PWA:** `/buy` mobile lane reuses IntentBar + gasless Enoki mint toggle, with installable manifest.
- [x] **#4 Mainnet-migration shim:** network-scoped config flips testnet↔mainnet IDs in one place; `deepbook_margin` composition is explicitly disabled until a verified compose target exists.
- [x] **#5 Replication = payoff settlement property test:** deterministic sampled catalog notes + Move settlement grid assert replicated payout equals target payoff.
- **CUT (do not build):** points flywheel, copy-trading, portfolio VaR, any new on-chain primitive. Keep only the creator leaderboard as demo dressing.

## P3 — Live / token-gated · blocked on tokens

- [ ] `pnpm verify:first` — latest shell run confirms current oracle/devInspect/create_manager/manager-ability seams; still needs funded escrow-backed roll proof.
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
| **2** | Live-verify all P1 integrations · deploy/fund once tokens arrive |
| **3** | P3.4 full e2e + digests · P4 video + README · submit (2-day buffer) |

**Critical-path reminder:** everything in P0/P1/P2 is offline-doable now; **P3 unlocks the win-half of the prize and is gated only on tokens.** Submit the token request first.
