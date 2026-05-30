# Predict Studio

Defined-risk strategy builder for DeepBook Predict.

Predict Studio turns raw Predict binary/range instruments into trader-facing payoff shapes, vault shares, tranches, collateral, and RFQ-routable baskets. The engine decomposes the chosen payoff into long-only Predict legs, repairs unsafe SVI slices, prices candidate decompositions with impact, certifies or exact-solves sparse baskets, and mints one owned `StructuredPosition` receipt with an on-chain max-loss envelope.

## What Is Implemented

- Thin Move wrapper in `move/sources/studio.move`
  - `build_and_mint` mints N Predict legs atomically from a funded `PredictManager`.
  - `build_and_mint_to_sender` transfers the resulting `StructuredPosition` to the sender.
  - `settle_to_receipt` redeems all legs and emits P&L.
  - `max_payout` computes best-case payout across strike breakpoints.
- Vault, tranche, collateral, RFQ, and Kiosk note Move modules
  - `vault.move` mints `Coin<STUDIO_LP>` shares with virtual-share donation defense, pending deposits, HWM fees, scoped KeeperCap automation, and capped publisher fees.
  - `pt_yt.move` splits vault shares into PT/YT and conserves redemption value through the maturity waterfall.
  - `studio_collateral.move` is an isolated dUSDC lending market against the provable floor of `Coin<STUDIO_LP>`.
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
  - live oracle panel
  - strategy picker, 12-product catalog, draw-any-payoff canvas, and scenario sliders
  - payoff chart, structure summary, solver inspector, mint action, vault market, tranches, creator leaderboard, portfolio grid, positions, and backtest
- Scripts in `scripts/`
  - verify-first live gate checker for `/oracles`, `create_manager`, devInspect quote decoding, and local config generation
  - deploy package
  - create and optionally fund a PredictManager
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
- `devInspect` quote decoding is verified by `pnpm verify:first`; May 30, 2026 runs against active oracle `0x11c5...1193` returned non-zero ATM ask/bid values.

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

- `oracleId`, `expiry`, `minStrike`, `tickSize`, and `dbp` are generated from `/oracles` + Sui RPC
- `dusdcType`, `dusdcCoinId`, and funded wallet details after receiving testnet dUSDC
- `managerId` after running `pnpm setup`

The app reads these public environment variables:

```bash
NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE=0x...
NEXT_PUBLIC_DEEPBOOK_PREDICT_PACKAGE=0x...
NEXT_PUBLIC_MANAGER_ID=0x...
NEXT_PUBLIC_DUSDC_TYPE=0x...::dusdc::DUSDC
```

## Live Commands

```bash
pnpm verify:first -- --write-config
pnpm bench
pnpm deploy
pnpm setup
pnpm keeper:roll -- --config=./keeper/config.json
pnpm dev
```

`pnpm bench`, `pnpm deploy`, and `pnpm setup` require a funded testnet wallet and dUSDC. Without those, local unit/build validation still passes but live mint/settle remains blocked.

## Remaining Live Gates

- Confirm vault-owned `PredictManager` borrowing semantics before wiring `vault::roll_into_strategy`.
- Confirm Enoki sponsor app id/allowlist, Pyth BTC/USD object id, Cetus custom-pool creation, Walrus publisher endpoint, Kiosk marketplace flow against testnet, and any Suilend listing story.
- Run `pnpm bench`, deploy, create/fund a manager, mint, settle, and record transaction digests once dUSDC and SUI are available.
