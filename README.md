# Predict Studio

Defined-risk strategy builder for DeepBook Predict.

Predict Studio turns raw Predict binary/range instruments into trader-facing payoff shapes: capped directional bets, ranges, peaks, strangles, and ramps. The engine decomposes the chosen payoff into long-only Predict legs, prices candidate decompositions, chooses the cheapest/fewest-leg form, and mints one owned `StructuredPosition` receipt with an on-chain max-loss envelope.

## What Is Implemented

- Thin Move wrapper in `move/sources/studio.move`
  - `build_and_mint` mints N Predict legs atomically from a funded `PredictManager`.
  - `build_and_mint_to_sender` transfers the resulting `StructuredPosition` to the sender.
  - `settle_to_receipt` redeems all legs and emits P&L.
  - `max_payout` computes best-case payout across strike breakpoints.
- TypeScript engine in `lib/`
  - template and freeform decomposition
  - cheapest decomposition optimizer
  - payoff curve, EV, implied probability, SVI digital pricing, and finite-difference Greeks
  - Predict client for devInspect quoting, mint/settle PTBs, and live oracle reads
  - `/oracles`-backed backtester
- Next app in `app/`
  - wallet provider on Sui testnet
  - live oracle panel
  - strategy picker and scenario sliders
  - payoff chart, structure summary, mint action, positions, and backtest
- Scripts in `scripts/`
  - deploy package
  - create and optionally fund a PredictManager
  - gas benchmark for per-PTB leg cap

The UI shell is adapted from the local Umbra terminal style and should be disclosed in the submission.

## Verified Integration Points

- Live indexer route `/oracles` works and returns Predict/oracle IDs, strike scale, status, expiry, and settled history.
- The previously assumed `/prices/latest` and `/history/settlements` routes returned `404`; the app now reads oracle object fields from Sui RPC and derives backtest history from `/oracles`.
- Oracle spot/forward/strike scale is `1e9` for BTC-like prices, matching strike grid values from `/oracles`.
- `oracle.move::compute_nd2` uses `d2 = (ln(F/K) - total_var/2) / sqrt(total_var)`, matching `lib/payoff.ts`.
- `PredictManager` creation is `deepbook_predict::predict::create_manager`; `predict_manager::new` is `public(package)` and cannot be called from scripts.

## Setup

```bash
pnpm install
pnpm test
sui move test -p move
pnpm build
```

For live minting, copy `scripts/config.example.json` to `scripts/config.json` and fill:

- `oracleId`, `expiry`, `minStrike`, `tickSize` from `curl https://predict-server.testnet.mystenlabs.com/oracles`
- `dbp` from the oracle object type
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
pnpm bench
pnpm deploy
pnpm setup
pnpm dev
```

`pnpm bench`, `pnpm deploy`, and `pnpm setup` require a funded testnet wallet and dUSDC. Without those, local unit/build validation still passes but live mint/settle remains blocked.
