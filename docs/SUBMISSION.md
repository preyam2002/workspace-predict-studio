# DeepSurge Submission Packet

## Project

**Name:** Predict Studio

**Primary track:** DeepBook Predict

**Secondary track:** DeFi

**Tagline:** The structured-note factory and marketplace on DeepBook Predict: describe a market view in English, get a fairly priced defined-risk note, buy it gasless.

## Short Description

Predict Studio turns DeepBook Predict's raw binary and range instruments into retail-legible structured notes. A user enters a market view in English, the app builds a long-only payoff, repairs unsafe SVI slices, solves a gas-bounded sparse replication, prices impact-aware Predict legs, and mints one on-chain `StructuredPosition` with max loss capped at premium paid.

## Problem

On-chain options are still a roughly $100M TVL category because payoff construction is too hard for normal users. Predict Studio makes options feel like a simple product workflow without hiding the on-chain proof: every note maps to concrete Predict legs and every live receipt can be settled against the oracle.

## Why Sui And DeepBook

DeepBook Predict gives Sui-native binary and range markets with oracle-settled payoffs. Predict Studio composes those markets into higher-level notes, vault shares, PT/YT tranches, RFQ fills, Kiosk royalty notes, Walrus specs, Enoki gasless onboarding, and Pyth-anchored analytics. Sui's object model lets the account-bound Predict positions sit inside a funded manager while users hold transferable receipts and `Coin<STUDIO_LP>` vault shares.

## Technical Highlights

- Long-only replication means max loss equals premium by construction.
- The Move wrapper enforces `premium_paid <= max_loss_budget` in the same PTB that mints the basket.
- The TypeScript engine combines arb-free SVI repair, gas-bounded NNOMP replication, exact sparse solving, and impact-aware leg ordering.
- Replication property tests assert that sampled note payouts match settlement across the strike grid.
- Vault NAV is oracle-marked across open Predict legs, not cash-only.
- PT/YT settlement conserves redemption value through the maturity waterfall.
- K2 note-backed lending is live: mint a `StructuredPosition`, lock it as collateral, borrow dUSDC, repay, and reclaim the note.
- RFQ is live: a market maker signs a quote off-chain (Ed25519 over canonical BCS), and `fill_quote` verifies the signature, binds the structure hash, blocks replay, and mints at the quoted premium in one PTB.
- Kiosk creator notes are live: a dedicated package claims a `Publisher` at publish so a real `TransferPolicy<StudioNote>` exists; notes are listed and resold with a capped on-chain royalty whose `RoyaltyPaid` events feed the creator leaderboard.

## Live Proof

```text
package:          0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f
manager:          0xd39a2f71907d2a577694525176d976973335cc0836ce3d1fb2a2a149689e9341
vault:            0xf2124bab010e4b934089c4bfc43a8bfec1cd0f459beac3df8f9d41cb6b1cfe11
publish:          145VJgqGLRyrmkCVFUuJfz3g1SeR69M8SW7vkWn5hSZH
sample mint:      7AHeK1yGErrNUwnd8ZAhtTZ3pY4VpDVWC9ZtcyLsbHC9
sample position:  0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95
sample settle:    3bafswkWphUEzUFkeCvfArhFe78ndcPgvgYoZyrLYCra payout=0 pnl=-524201
vault roll:       GDCEH8qro2ueVpEuzRXZjgFSywVd6P98x2GTJkyfA5M9
vault position:   0x6d1f4514a140dd35d548aa49292486e58cd7fe6a66366b244054fe1a5273b299
vault settle:     7cGNwsGmo2i7wnogcKtf4869a1HrHM6dPiMqH3qMRLqR payout=1000000 pnl=+472196
k2 package:       0x3925e59c067dbf176f6d4134427c1bd1332f5fb15c85a6df86f3465763ae0f24
k2 mint+borrow:   J1tUZaHP47HZFsw4XWz5e23Sg2KRyWyXmTSbLB2kptow
k2 repay+reclaim: 3Zx1QbGhrmNgheiF1xvDGFAaepbMTaCrG1hz8Kd6fZri
rfq book:         0xb9344db75cb09c5d6ac9bdcdb754b5e223fb72097e003ac66980dbf259ac3a1c
rfq fill:         Au7kNUb4ESc3HnwyD3Deqtnbi3shhycKmsnwiGnUx5dG
kiosk package:    0x5df1555db1cef4ce0a4c3d456aa439721b85d503c96f848ed4afa74dba6b74ca
kiosk policy:     0x91dc1affc79474253a3462076131d95b37f2f515ba9d8189247d1d8fea89fcc8
kiosk mint+list:  J4DT4sKcShLZ73yoYB5y5BJmAq56kR5NFt9bcFU7asrd
kiosk purchase:   EXE8iG37EPyk5jGpT6FwRRecSPwEZtaE55C389TQ93Ca
```

Transaction history is pruned by many public testnet RPCs after a few days; re-verify these digests against a full-history node such as `https://fullnode.testnet.sui.io:443` (the proof objects persist on any fullnode).

## Demo Flow

1. Type a BTC market view in English.
2. Show the generated note, premium, max loss, max gain, payoff curve, and Greeks.
3. Open the replication-proof panel: this note equals a concrete Predict basket in one PTB.
4. Mint the live note and show the digest.
5. Show the owned `StructuredPosition`, then the recorded sample and vault settlement digests.
6. Show the K2 prime-broker beat: mint a note, borrow dUSDC against its marked value, repay, and reclaim the note.
7. Show the RFQ beat: a maker signs a quote for the structure and the wallet fills it on-chain in one `fill_quote` PTB. Then the Kiosk beat: tokenize the note and list it, and show a resale paying a real royalty that lands on the creator leaderboard.
8. Show vault NAV vs secondary-market panel, PT/YT split, creator leaderboard, Walrus share link, and backtest panel.
9. Close with mainnet readiness: config shim is ready; Predict is testnet-only today; Margin composition stays roadmap until a verified Margin-to-Predict target exists.

## Current Disclosures

- Enoki gasless lane is implemented but live smoke needs `NEXT_PUBLIC_ENOKI_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and `ENOKI_PRIVATE_KEY`.
- Local address inventory confirms the active wallet holds `65.113914016` SUI, `0.037513` Predict dUSDC, and `1999.999999` `STUDIO_LP`; other local aliases hold another `0.2331732` SUI. No local address has funded DEEP or dBUSDC.
- Secondary market requires a configured Cetus pool or funded DeepBook Spot path. DeepBook Spot pool creation is wired and uses official SDK testnet registry/package defaults, but current wallets have `0` funded DEEP and permissionless pool creation requires 500 DEEP.
- The live DEEP/SUI testnet pool did not unblock funding in the latest check: 10 DEEP quoted at about `0.2244` SUI and 50+ DEEP returned no liquidity.
- Predict is testnet-only today; mainnet readiness is represented by network-scoped config and deployable non-Predict surfaces.
- `pnpm hackathon:status` remains blocked until Enoki keys, `ANTHROPIC_API_KEY`, a secondary-market path, `DEMO_VIDEO_URL`, and `DEEPSURGE_SUBMISSION_URL` are recorded.

## Verification Commands

```bash
pnpm verify:first
pnpm address:inventory
pnpm deepbook:spot-check -- --all-addresses --dry-run
pnpm settle:sample
pnpm settle:vault
pnpm collateral:demo
pnpm rfq:demo -- --verify
pnpm kiosk:demo -- --verify
pnpm live:proof
pnpm hackathon:status
pnpm submission:check
pnpm demo:evidence
pnpm vitest run
pnpm build
MOVE_HOME=$(mktemp -d) sui move test -p move
```
