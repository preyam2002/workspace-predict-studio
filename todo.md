# Predict Studio — Road to Sui Overflow 2026 Submission

**Deadline:** June 21, 2026 (Pacific) · Portal: DeepSurge · Primary track: **DeepBook Predict** ($70k pool, least crowded) · Prize: $35k first, **50% on win + 50% on mainnet deploy**.

**One-liner pitch:** *The structured-note factory & marketplace on DeepBook Predict — describe your market view in English, get a fairly-priced defined-risk note, buy it gasless.*

**Current state (2026-06-03):** Offline build complete and test-green (Move 44/44, vitest 125/125, tsc + next build clean). Engine, all Move modules, mesh integrations, AI front-door, greeks/payoff analytics, mobile buy-lane PWA, mainnet config shim, replication property tests, NL-first landing, replication-proof panel, shareable Walrus note URL, live testnet deploy/mint, and sample/vault settlement proof are done. **The remaining live gates are Enoki credentials, a funded/configured secondary-market path, demo video, and DeepSurge submission.** Detailed specs live in `docs/superpowers/plans/2026-05-31-predict-studio-completion.md`.

---

## 🔴 CRITICAL PATH — do these or there is no submission

- [x] **Get testnet tokens**: 5,000 dUSDC landed and was deposited into the funded PredictManager. `pnpm address:inventory` now confirms active address `cool-dichroite` has `0.250509634` SUI plus `1999.999999` `STUDIO_LP`, with another `0.03517108` SUI on `distracted-garnet` and `0.19800212` SUI on `mystifying-epidote`. No local address currently has funded Predict dUSDC, funded DEEP, or funded dBUSDC; top up before heavier live runs.
- [x] **Deploy to testnet**: package `0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f`, publish digest `145VJgqGLRyrmkCVFUuJfz3g1SeR69M8SW7vkWn5hSZH`; live env values are in `README.md`.
- [x] **One real mint→settle→redeem on testnet** with captured tx digests. Mint digest `7AHeK1yGErrNUwnd8ZAhtTZ3pY4VpDVWC9ZtcyLsbHC9`, position `0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95`; sample settle digest `3bafswkWphUEzUFkeCvfArhFe78ndcPgvgYoZyrLYCra`, payout `0`, PnL `-524201`. Vault roll digest `GDCEH8qro2ueVpEuzRXZjgFSywVd6P98x2GTJkyfA5M9`, position `0x6d1f...b299`; vault settle digest `7cGNwsGmo2i7wnogcKtf4869a1HrHM6dPiMqH3qMRLqR`, payout `1000000`, PnL `+472196`.
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
- [x] Enoki zkLogin wallet registration + sponsored gasless mint (`7e71ef8`, `c0a267c`) — [ ] **verify live:** blocked on missing `NEXT_PUBLIC_ENOKI_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and `ENOKI_PRIVATE_KEY`. The buy lane uses local `/api/sponsor` + `/api/execute`, so no separate sponsor URL is required.
- [x] Pyth live BTC NAV anchor (`50b91a0`) — [x] **verify live:** June 3 smoke returned BTC price `67120.14749999`, `stale=false`, publish time `1780472427`.
- [x] Cetus STUDIO_LP/dUSDC secondary market (`be3ea95`) — [ ] **verify live custom pool:** API route is wired, but currently returns `source=mock` because no `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID` is configured.
- [x] Walrus note-spec storage (`66783ca`) — [x] **verify live:** PUT/GET round-tripped blob `P22yPopLTgDmFxBakwMf2H_XEpYKpwtgOGI0c4XYotU`.
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

## P3 — Live / token-gated · deploy and mint done

- [x] `pnpm verify:first -- --write-config` — latest shell run confirms current `/oracles`, `create_manager`, devInspect quote, active oracle `0x62a0...d2f2`, and manager/vault config preservation. The live sample mint remains on oracle `0xd156...1c4b`.
- [x] `pnpm bench` — latest gas benchmark measured `MAX_SPONSORED_LEGS_UNDER_5M=1` and `MAX_TESTED_LEGS_PER_PTB=20` on the refreshed near-expiry oracle.
- [x] Deploy all packages; create + fund a `PredictManager`; create a vault, manager escrow, and KeeperCap.
- [x] Live mint with captured digest: `7AHeK1yGErrNUwnd8ZAhtTZ3pY4VpDVWC9ZtcyLsbHC9`; `StructuredPosition` object `0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95` verified with `sui client object`.
- [x] Full e2e settle→redeem after the sample oracle settled; sample digest `3bafswkWphUEzUFkeCvfArhFe78ndcPgvgYoZyrLYCra`, vault digest `7cGNwsGmo2i7wnogcKtf4869a1HrHM6dPiMqH3qMRLqR`. `pnpm live:proof` prints both from `deploy.json`.
- [x] Validate the escrow-backed roll path (the one architectural risk): seeded the vault from the funded manager (`CRMDRdf4TcFvJViDZHCPkMYyBkc2XqBU7VZSxW4LHmzF`), granted KeeperCap (`2A1ndCzTofieGFEVFWbzwEvTMSHAVaxsCEWVpajd14Ad`), and executed `keeper_roll → fund_manager_from_idle → roll_into_strategy` (`GDCEH8qro2ueVpEuzRXZjgFSywVd6P98x2GTJkyfA5M9`).
- [ ] Wire live config into all 4 mesh integrations + smoke-test. Pyth and Walrus freshly pass; Enoki requires Portal keys/OAuth; Cetus needs a real STUDIO_LP/dUSDC pool id.
- [ ] DeepBook Spot secondary pool: evaluated from current DeepBook source, `pnpm address:inventory`, and `pnpm deepbook:spot-check -- --all-addresses --dry-run`. `pool::create_permissionless_pool<STUDIO_LP, dUSDC>` exists, and the checker now uses the official SDK testnet registry/package defaults, but creation requires a `Coin<DEEP>` fee of `500_000_000` (500 DEEP). Active address `cool-dichroite` has the `STUDIO_LP` coin object, but all six local Sui addresses still have `0 funded DEEP`; `mystifying-epidote` only has three zero-balance DEEP coin objects. The live DEEP/SUI testnet pool quoted only 10 DEEP at about `0.2702` SUI and 50+ DEEP returned no liquidity, so keep Cetus/mock fallback until DEEP is funded.
- [x] Shell-native readiness gate: `pnpm hackathon:status` runs `verify:first`, wallet address inventory, all-address DeepBook DEEP readiness plus pool-create dry-run when funded, sample settlement, vault settlement, Enoki config, secondary-market config, demo-video proof, and DeepSurge-submission proof. Secondary-market readiness passes with either `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID` or a funded, registry-ready DeepBook Spot path; current live state reports `pass=4 blocked=5 fail=0`. `.env.example` documents every live-demo variable the gate expects.

Live IDs:
- `managerId`: `0xd39a2f71907d2a577694525176d976973335cc0836ce3d1fb2a2a149689e9341`
- `vaultId`: `0xf2124bab010e4b934089c4bfc43a8bfec1cd0f459beac3df8f9d41cb6b1cfe11`
- `managerEscrowId`: `0x81ee6374ad556fb7d76bf0a3a2ba7faf2c4c93d90896c373d0f3fd0ab8982013`
- `keeperCapId`: `0x592a98437e5d30e2b758cdc6f721a6f20cdc691e8326c8285f462faa919c512d`, grant digest `2A1ndCzTofieGFEVFWbzwEvTMSHAVaxsCEWVpajd14Ad`

## P4 — Demo & submission

- [ ] 5-min video: hero beat = type a market view → note → gasless buy. Show optimizer "same payoff 3 ways", mint digest, settle, vault NAV-vs-secondary, backtest.
- [x] README + DEMO.md with `packageId`, live tx digests, the long-only/max-loss invariant, the 4 technical kernels, **explicit mainnet-readiness + Margin-composability paragraph**. Disclose Umbra UI-shell adaptation. Tagging `v1.0-overflow` remains after final video/submission review.
- [x] DeepSurge submission packet drafted and machine-checked in `docs/SUBMISSION.md` with portal copy, live proof digests, demo beats, current disclosures, and verification commands. `pnpm submission:check` reports `submission_packet_ready=true`; `pnpm demo:evidence` writes the current shell-output bundle to `docs/DEMO_EVIDENCE.md`.
- [ ] Submit to DeepSurge (DeepBook primary, DeFi secondary).

---

## Weekly cadence (≈3 weeks)

| Week | Focus |
|---|---|
| **1 (now)** | Tokens received · P0 marked-NAV + PT/YT settlement done · deployed · manager/vault funded · first live mints captured |
| **2** | Enoki live smoke · secondary-market config/funding · video |
| **3** | P4 video + final README/digests · tag `v1.0-overflow` · submit (2-day buffer) |

**Critical-path reminder:** deploy, mint, sample settlement, and vault settlement are live. The next proof is Enoki + secondary-market config, then the video/submission.

---

## 2026-06-04 — Learnings & K2 collateral fold-in

Distilled from a strategy session. Full executable spec: `docs/superpowers/plans/2026-06-04-predict-studio-k2-completion.md`. Centerpiece below; remaining work is the external submission gates.

**The one highest-value enhancement — K2 collateral fold-in (the new demo spine):** ✅ **Phase 1 core implemented 2026-06-05 (Move 47/47, vitest 129/129, build clean).** `open_note_position`/`close_note`/`note_collateral_value` + `buildMintAndBorrowTx` (one PTB) + `NoteCollateralPanel`. Basis = on-chain `min(marked_bid, max_payout)` (the sound, ungameable version — see plan), framed as a repay-to-reclaim bridge, `max loss = premium` preserved. Remaining: 🔒 deploy a `CollateralMarket` + live `collateral:demo` digests + `hackathon:status` gate.
- [x] Turn `studio_collateral.move` from "lends dUSDC against idle vault shares only" into "lends dUSDC against ANY owned `StructuredPosition` note, capped at the note's provably-bounded worst-case value."
- [ ] The provable floor is on-chain and already computable: a long-only basket pays **at most `studio::max_payout(legs)` and at least 0** at settlement — a knowable ceiling/floor with no oracle needed. Bounded vertical-range legs are `[0, max_payout]` by construction; the per-note `max_gain` field is exactly `max_payout(&legs)`. Borrow capacity = `LTV * provable_floor` where the conservative floor is `0` and the collateral-valuation ceiling is `max_payout`; the live redeemable value is `studio::marked_value(predict, oracle, pos, clock)` (bid side).
- [ ] This requires wiring **marked-NAV settlement** so positions that are *currently rejected* as collateral (open, non-idle) become eligible: value the locked note by its marked bid (already implemented as `studio::marked_value`) and/or its bounded `max_payout`, instead of the existing `EVaultNotIdle` rejection on vault shares.
- [ ] New live demo beat (replaces the share-deposit beat as the depth climax): **build a defined-risk note in English → in the SAME PTB borrow dUSDC against its provable floor → repay → reclaim the note.** Upgrades the pitch from "a builder of notes" to "a builder AND a mini prime-broker for Predict" — strongest real-world + composability story, ~70% of the code already exists (`max_payout`, `marked_value`, `StructuredPosition` wrapper, `CollateralMarket`, `BorrowPosition`, `collateral-client.ts`).

**Why this collapses the standalone "borrow against a Predict position" idea into Predict Studio:**
- [ ] Predict positions are **non-transferable** (owner-bound table rows inside `PredictManager`) → they cannot be used as collateral directly. The only collateralizable object is the ownable `StructuredPosition` wrapper, which Predict Studio already mints. So "Lumen / borrow against a Predict position" has no standalone surface — it *is* Predict Studio.

**Guardrails (do not violate):**
- [ ] **Margin stays excluded.** Keep the clean `max loss = premium` invariant. Predict has zero margin references. Mention margin only as a one-line roadmap item, never build it.
- [ ] Don't over-build new surface area. The win is making existing depth *live* plus the collateral demo — not new primitives.

**Already done this session (do NOT redo):**
- [x] README opener sharpened (the $100M-options-gap wedge + spine).
- [x] `DEMO.md` rewritten into a timed 5-minute video script.

**Remaining EXTERNAL gates (Codex cannot fully complete these — human-in-the-loop):**
- [ ] Enoki public API key + Google OAuth client + private sponsor key (gasless lane).
- [ ] Secondary market: 500 DEEP for the DeepBook Spot permissionless pool, OR a `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID`.
- [ ] Record the 5-minute demo video (now featuring the K2 borrow-against-note beat); set `DEMO_VIDEO_URL`.
- [ ] Submit to DeepSurge (DeepBook primary, DeFi secondary); set `DEEPSURGE_SUBMISSION_URL`.

**Track reminder:** One project = one track is confirmed. Predict Studio = **DeepBook Predict** (primary), **DeFi** (secondary). The K2 fold-in strengthens both axes without splitting the entry.
