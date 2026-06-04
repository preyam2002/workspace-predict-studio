# Predict Studio

**The structured-note factory for DeepBook Predict — describe a market view in English, get a fairly priced, defined-risk note, and mint it on-chain in one transaction. Max loss = premium, by construction.**

## The $100M question

On-chain options have sat at roughly **$100M TVL for years** — in the sponsor's own words, *"not a competitive market, an underdeveloped one."* Next door, the same traders pushed **$7.35T** through perp DEXs in 2025, Polymarket cleared **$7B** in a single month at ~70k DAU, and Hyperliquid alone did **$844M** in revenue. The appetite for directional, leveraged bets is not the problem. **Payoff construction is** — building a spread or a defined-risk structure means hand-picking strikes, legs, and sizes, work that normal users will never do.

Predict Studio collapses that into one English sentence. You type *"BTC above $70k by Friday, risk $50."* The engine builds a long-only payoff, repairs unsafe SVI slices, solves a gas-bounded sparse replication off Block Scholes' own on-chain oracle, prices the Predict legs with market impact, and mints a single owned `StructuredPosition` whose max loss is capped at the premium you paid — enforced in the same PTB that builds the legs.

That receipt is then a primitive: it becomes vault shares, PT/YT tranches, lending collateral, RFQ-routable baskets, and Kiosk-tradeable creator notes. This is the sponsor's exact thesis — *"spreads and structured products become a question of UX, not infrastructure"* — shipped and live on testnet.

## What Is Implemented

- Thin Move wrapper in `move/sources/studio.move`
  - `build_and_mint` mints N Predict legs atomically from a funded `PredictManager`.
  - `build_and_mint_to_sender` transfers the resulting `StructuredPosition` to the sender.
  - `settle_to_receipt` redeems all legs and emits P&L.
  - `max_payout` computes best-case payout across strike breakpoints.
- Vault, tranche, collateral, RFQ, and Kiosk note Move modules
  - `studio_lp.move` creates the real `STUDIO_LP` currency and publish-time share factory.
  - `vault.move` consumes that factory to create/share a depositable vault, mints `Coin<STUDIO_LP>` shares with virtual-share donation defense, pending deposits, HWM fees, scoped KeeperCap automation, capped publisher fees, signer-owned PredictManager escrow binding, and an escrow-backed strategy roll path.
  - `pt_yt.move` splits vault shares into PT/YT and conserves redemption value through the maturity waterfall.
  - `studio_collateral.move` is an isolated dUSDC lending market against idle, vault-valued `Coin<STUDIO_LP>` collateral; borrowing is capped at `LTV * provable_floor`, and open-strategy vault shares are rejected until marked NAV settlement is wired.
  - `rfq.move` verifies Ed25519 signatures over canonical BCS quote bytes, binds quotes to the canonical structure hash, enforces TTL, prevents replay, and exposes an atomic `fill_quote` path.
  - `note_kiosk.move` wraps bespoke notes as Kiosk-tradeable objects with a production TransferPolicy helper, capped royalty rule, and locked-sale enforcement.
- TypeScript engine in `lib/`
  - template and freeform decomposition
  - NNOMP sparse solver, exact sparse solve, branch-and-bound wrapper, and coherence certificates
  - arbitrage-free SVI guard with density repair for monotone non-negative digitals
  - impact-aware basket pricing, optimal leg ordering, and split-candidate evaluation
  - payoff curve, EV, implied probability, guarded SVI digital pricing, and finite-difference Greeks
  - Predict, vault, tranche, collateral, RFQ, creator-fee, Enoki-style sponsor, Pyth, Cetus, and Walrus helper clients
  - `/oracles`-backed backtester, portfolio scenario-grid analytics, and publisher leaderboard event aggregation
- Next app in `app/`
  - wallet provider on Sui testnet
  - NL-first landing page with the expert builder moved to `/advanced`
  - live oracle panel
  - strategy picker, 12-product catalog, draw-any-payoff canvas, and scenario sliders
  - payoff chart, per-note greeks, replication-proof panel, shareable Walrus-backed note URL, structure summary, solver inspector, mint action, vault market, tranches, creator leaderboard, portfolio grid, positions, and backtest
  - mobile `/buy` PWA lane for the gasless AI-intent note flow
- Scripts in `scripts/`
  - verify-first live gate checker for `/oracles`, `create_manager`, devInspect quote decoding, and local config generation
  - deploy package and record the publish-time `ShareFactory`
  - create and optionally fund a PredictManager; if deployed package/factory data is present, create a shared vault and manager escrow
  - gas benchmark for per-PTB leg cap
  - deterministic seed config for the 12 demo vaults
  - keeper dry-run planner for pending-deposit processing / roll PTBs

The UI shell is adapted from the local Umbra terminal style and should be disclosed in the submission.

## Verified Integration Points

- Live indexer route `/oracles` works and returns Predict/oracle IDs, strike scale, status, expiry, and settled history.
- The previously assumed `/prices/latest` and `/history/settlements` routes returned `404`; the app now reads oracle object fields from Sui RPC and derives backtest history from `/oracles`.
- Oracle spot/forward/strike scale is `1e9` for BTC-like prices, matching strike grid values from `/oracles`.
- `oracle.move::compute_nd2` uses `d2 = (ln(F/K) - total_var/2) / sqrt(total_var)`, matching `lib/payoff.ts`.
- `PredictManager` creation is `deepbook_predict::predict::create_manager`; `predict_manager::new` is `public(package)` and cannot be called from scripts.
- `devInspect` quote decoding is verified by `pnpm verify:first`; the latest June 3 shell run selected active oracle `0x62a0...d2f2` and returned non-zero ATM ask/bid values (`ask=506665`, `bid=486665`). The sample mint/settlement receipt below remains tied to earlier oracle `0xd156...1c4b`.
- June 3 mesh smokes: Pyth BTC returned `price=67120.14749999`, `stale=false`, `publishTime=1780472427`; Walrus PUT/GET round-tripped blob `P22yPopLTgDmFxBakwMf2H_XEpYKpwtgOGI0c4XYotU`.
- `pnpm address:inventory` prints the live local-address inventory for SUI, Predict dUSDC, `STUDIO_LP`, DEEP, and dBUSDC. Current status: active address `cool-dichroite` has `0.250509634` SUI plus `1999.999999` `STUDIO_LP`; `distracted-garnet` has `0.03517108` SUI; `mystifying-epidote` has `0.19800212` SUI and three zero-balance DEEP coin objects; no local address has funded Predict dUSDC, funded DEEP, or funded dBUSDC.
- `pnpm deepbook:spot-check -- --all-addresses --dry-run` verifies the DeepBook Spot secondary-market gate across every local Sui address and, once funded, devInspects `pool::create_permissionless_pool<STUDIO_LP, dUSDC>` against the official SDK testnet registry/package defaults. Current status is `blocked_missing_deep`: current DeepBook source requires a `Coin<DEEP>` creation fee of `500000000` units (500 DEEP), all six local Sui addresses have `0 funded DEEP`, and the live DEEP/SUI testnet pool quote only returns liquidity for 10 DEEP at about `0.2702` SUI.

## Live Testnet Proof

Current deployed testnet package:

```text
packageId:        0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f
shareFactoryId:   0xb497117b999c19ed7962896c5fb6c9d380ac0e189a378dc938f9d26ae9601ff0
managerId:        0xd39a2f71907d2a577694525176d976973335cc0836ce3d1fb2a2a149689e9341
vaultId:          0xf2124bab010e4b934089c4bfc43a8bfec1cd0f459beac3df8f9d41cb6b1cfe11
managerEscrowId:  0x81ee6374ad556fb7d76bf0a3a2ba7faf2c4c93d90896c373d0f3fd0ab8982013
keeperCapId:      0x592a98437e5d30e2b758cdc6f721a6f20cdc691e8326c8285f462faa919c512d
dUSDC type:       0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
```

Captured transactions:

```text
publish:          145VJgqGLRyrmkCVFUuJfz3g1SeR69M8SW7vkWn5hSZH
create manager:   BY89F4XYk1HGKNZHKfL8Z8Q29Fcoq54LCaP1sEiVsp1v
fund manager:     Bcp5nPaNTZRA8mYkVjMcCHdBakEeRCRE5zFRwiAU6knG
create vault:     CbG746bir7Tp6sFnyGxBmyq1rmkF4e9DtbTzkFW2ofUb
grant keeper cap: 2A1ndCzTofieGFEVFWbzwEvTMSHAVaxsCEWVpajd14Ad
seed vault:       CRMDRdf4TcFvJViDZHCPkMYyBkc2XqBU7VZSxW4LHmzF
keeper roll:      GDCEH8qro2ueVpEuzRXZjgFSywVd6P98x2GTJkyfA5M9
sample mint:      7AHeK1yGErrNUwnd8ZAhtTZ3pY4VpDVWC9ZtcyLsbHC9
sample position:  0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95
sample settle:    3bafswkWphUEzUFkeCvfArhFe78ndcPgvgYoZyrLYCra payout=0 pnl=-524201
vault settle:     7cGNwsGmo2i7wnogcKtf4869a1HrHM6dPiMqH3qMRLqR payout=1000000 pnl=+472196
```

The escrow-backed vault roll is live: `keeper_roll → fund_manager_from_idle → roll_into_strategy` minted vault position `0x6d1f4514a140dd35d548aa49292486e58cd7fe6a66366b244054fe1a5273b299` with premium/max loss `527804` and max gain `1000000`.

Latest `pnpm bench` on the refreshed near-expiry oracle:

```text
MAX_SPONSORED_LEGS_UNDER_5M=1
MAX_TESTED_LEGS_PER_PTB=20
```

Sample note details:

```text
shape:            live_near_expiry_call
oracle:           0xd1569da6552c7878df9ce58a2f4456e4fc3aca38add4cea18f15f1708f871c4b
expiry:           2026-06-03T09:15:00.000Z
strike:           67092000000000
quantity:         1000000
premium/max loss: 524201
max gain:         1000000
```

The object proof is `sui client object 0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95 --json`: it is an owned `StructuredPosition` that settled after oracle `0xd156...1c4b` resolved. `pnpm live:proof` prints the current digest/payout summary from `deploy.json`.

## Setup

```bash
pnpm install
pnpm verify:first
pnpm test
sui move test -p move
pnpm build
pnpm seed:vaults
```

For live minting, generate the current public config and then fill the wallet-specific fields:

```bash
pnpm verify:first -- --write-config
```

Use `.env.example` as the canonical live-demo environment checklist; it includes the current deployed IDs plus the Enoki, Cetus or DeepBook Spot, Walrus, AI, demo-video, and DeepSurge proof fields needed by `pnpm hackathon:status`. Use `docs/SUBMISSION.md` as the ready-to-paste DeepSurge packet.

- `oracleId`, `expiry`, `minStrike`, `tickSize`, and `dbp` are generated from `/oracles` + Sui RPC
- `dusdcType`, `dusdcCoinId`, and funded wallet details after receiving testnet dUSDC
- `managerId`, `vaultId`, and `managerEscrowId` after running `pnpm setup`

The app reads these public environment variables:

```bash
NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE=0x...
NEXT_PUBLIC_DEEPBOOK_PREDICT_PACKAGE=0x...
NEXT_PUBLIC_MANAGER_ID=0x...
NEXT_PUBLIC_DUSDC_TYPE=0x...::dusdc::DUSDC
NEXT_PUBLIC_VAULT_ID=0x...
NEXT_PUBLIC_ORACLE_ID=0x...
NEXT_PUBLIC_CETUS_STUDIO_POOL_ID=0x... # optional; app labels the fallback as mock when unset
DEEPBOOK_REGISTRY_ID=0x...             # optional; defaults to official DeepBook Spot testnet registry
DEEPBOOK_SPOT_PACKAGE_ID=0x...         # optional; defaults to official DeepBook Spot testnet package
NEXT_PUBLIC_STUDIO_LP_TYPE=0x...::studio_lp::STUDIO_LP # optional; derived from package when unset
NEXT_PUBLIC_DUSDC_COIN_ID=0x...        # optional deposit button coin object
NEXT_PUBLIC_STUDIO_LP_COIN_ID=0x...    # optional withdraw button coin object
NEXT_PUBLIC_PENDING_RECEIPT_ID=0x...   # optional queued-deposit claim receipt
NEXT_PUBLIC_TRANCHE_VAULT_ID=0x...
NEXT_PUBLIC_PT_COIN_ID=0x...           # optional PT action coin object
NEXT_PUBLIC_YT_COIN_ID=0x...           # optional YT action coin object
NEXT_PUBLIC_TRANCHE_FLOOR_BPS=8000
NEXT_PUBLIC_WALRUS_PUBLISHER=https://publisher.walrus-testnet.walrus.space
NEXT_PUBLIC_WALRUS_AGGREGATOR=https://aggregator.walrus-testnet.walrus.space
```

For the mainnet-readiness story, network-scoped overrides use the same suffix:

```bash
NEXT_PUBLIC_SUI_NETWORK=mainnet
NEXT_PUBLIC_MAINNET_PREDICT_STUDIO_PACKAGE=0x...
NEXT_PUBLIC_MAINNET_DEEPBOOK_PREDICT_PACKAGE=0x...
NEXT_PUBLIC_MAINNET_MANAGER_ID=0x...
NEXT_PUBLIC_MAINNET_DUSDC_TYPE=0x...::dusdc::DUSDC
```

The config shim exposes Margin composition only when both `NEXT_PUBLIC_MARGIN_PACKAGE` and `NEXT_PUBLIC_MARGIN_COMPOSE_TARGET` are supplied. No verified public `deepbook_margin` to Predict compose target is wired by default.

The intent API also reads these server-only variables:

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6 # optional
```

Gasless Enoki minting reads:

```bash
NEXT_PUBLIC_ENOKI_API_KEY=...
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...
ENOKI_PRIVATE_KEY=...
```

The buy lane uses the app's local `/api/sponsor` and `/api/execute` routes; no separate public sponsor URL is required.

## Live Commands

```bash
pnpm verify:first -- --write-config
pnpm bench
pnpm deploy
pnpm setup
pnpm address:inventory
pnpm deepbook:spot-check -- --all-addresses --dry-run
pnpm settle:sample
pnpm settle:vault
pnpm live:proof
pnpm hackathon:status
pnpm submission:check
pnpm demo:evidence
pnpm keeper:roll -- --config=./keeper/config.json
pnpm dev
```

`pnpm bench`, `pnpm deploy`, and `pnpm setup` require a funded testnet wallet and dUSDC. `pnpm address:inventory` checks all local Sui aliases for the wallet assets that gate live demo work. `pnpm settle:sample -- --execute` and `pnpm settle:vault -- --execute` require the sample oracle to be settled. `pnpm deepbook:spot-check -- --all-addresses --dry-run` requires at least 500 DEEP before it devInspects `pool::create_permissionless_pool<STUDIO_LP, dUSDC>`; the checker uses official DeepBook Spot testnet registry/package defaults when env vars are unset. `pnpm hackathon:status` runs the live shell gates, including wallet inventory, plus Enoki/secondary-market config checks; secondary-market readiness passes with either `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID` or a funded, registry-ready DeepBook Spot path, and reports pass/blocked/fail without browser automation.
It also requires `DEMO_VIDEO_URL` and `DEEPSURGE_SUBMISSION_URL` before reporting `hackathon_ready=true`, so the final gate cannot pass on code and live digests alone.
`pnpm submission:check` verifies the ready-to-paste DeepSurge packet has the required sections, live proof digests, disclosures, and repo-correct verification commands.
`pnpm demo:evidence` writes `docs/DEMO_EVIDENCE.md` with the exact shell outputs to show or reference while recording.

Current testnet env values:

```bash
NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE=0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f
NEXT_PUBLIC_DEEPBOOK_PREDICT_PACKAGE=0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
NEXT_PUBLIC_MANAGER_ID=0xd39a2f71907d2a577694525176d976973335cc0836ce3d1fb2a2a149689e9341
NEXT_PUBLIC_DUSDC_TYPE=0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
NEXT_PUBLIC_VAULT_ID=0xf2124bab010e4b934089c4bfc43a8bfec1cd0f459beac3df8f9d41cb6b1cfe11
NEXT_PUBLIC_ORACLE_ID=0xd1569da6552c7878df9ce58a2f4456e4fc3aca38add4cea18f15f1708f871c4b
```

## Remaining Live Gates

- Confirm Enoki public API key, Google OAuth client, and private sponsor key.
- Configure a secondary-market path: `NEXT_PUBLIC_CETUS_STUDIO_POOL_ID`, or 500 funded DEEP for the DeepBook Spot dry-run. The active wallet already has the `STUDIO_LP` coin object; DEEP remains the missing asset.
- Record the 5-minute demo video, set `DEMO_VIDEO_URL`, submit to DeepSurge, and set `DEEPSURGE_SUBMISSION_URL`. Pyth, Walrus, deploy, mint, sample settlement, and vault settlement have fresh shell proof.
- Top up SUI before long live-demo runs; wallet balance after deployment, setup, two mints, and two settlements is low.
