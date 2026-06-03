# Demo Script

Target length: 5 minutes.

1. Connect wallet and show the BTC Predict oracle panel: spot, forward, strike tick, expiry, and SVI sigma.
2. Run `pnpm verify:first` in the terminal to show the live `/oracles`, `create_manager`, and devInspect quote gates passing.
3. Pick a catalog note, then switch to the draw-any-payoff canvas and reshape the curve.
4. Show the solver inspector: the same payoff is repriced across sparse leg budgets and certified/exact-solved when needed.
5. Show the payoff chart, max loss, max gain, EV, and optimizer savings.
6. Move the spot and SVI sigma sliders; the payoff, premium, solver output, and portfolio grid update immediately.
7. Show vault market, PT/YT split, portfolio floor, creator fee attribution, publisher leaderboard, and secondary price vs NAV.
8. Mint the structure with one PTB; show the digest and the owned `StructuredPosition`.
9. Open positions and show the live near-expiry receipt. After the oracle settles, run `pnpm settle:sample -- --execute` plus `pnpm settle:vault -- --execute` and show the settle digests.
10. Run the backtest panel against settled `/oracles` data and show hit rate plus P&L distribution.

## Live Testnet Proof

Use these IDs in the recording:

```text
packageId:        0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f
managerId:        0xd39a2f71907d2a577694525176d976973335cc0836ce3d1fb2a2a149689e9341
vaultId:          0xf2124bab010e4b934089c4bfc43a8bfec1cd0f459beac3df8f9d41cb6b1cfe11
keeperCapId:      0x592a98437e5d30e2b758cdc6f721a6f20cdc691e8326c8285f462faa919c512d
publish digest:   145VJgqGLRyrmkCVFUuJfz3g1SeR69M8SW7vkWn5hSZH
fund digest:      Bcp5nPaNTZRA8mYkVjMcCHdBakEeRCRE5zFRwiAU6knG
keeper digest:    2A1ndCzTofieGFEVFWbzwEvTMSHAVaxsCEWVpajd14Ad
vault seed:       CRMDRdf4TcFvJViDZHCPkMYyBkc2XqBU7VZSxW4LHmzF
keeper roll:      GDCEH8qro2ueVpEuzRXZjgFSywVd6P98x2GTJkyfA5M9
mint digest:      7AHeK1yGErrNUwnd8ZAhtTZ3pY4VpDVWC9ZtcyLsbHC9
positionId:       0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95
sample settle:    3bafswkWphUEzUFkeCvfArhFe78ndcPgvgYoZyrLYCra payout=0 pnl=-524201
vault settle:     7cGNwsGmo2i7wnogcKtf4869a1HrHM6dPiMqH3qMRLqR payout=1000000 pnl=+472196
```

The sample position is `live_near_expiry_call`, a one-leg Predict binary call on oracle `0xd1569da6552c7878df9ce58a2f4456e4fc3aca38add4cea18f15f1708f871c4b`, expiring on June 3, 2026 at 09:15 UTC. It paid premium/max loss `524201` for max gain `1000000`, then settled for payout `0`. The vault also had a live escrow-backed `keeper_auto_range` position `0x6d1f4514a140dd35d548aa49292486e58cd7fe6a66366b244054fe1a5273b299`, premium/max loss `527804`, minted by `keeper_roll → fund_manager_from_idle → roll_into_strategy`, then settled for payout `1000000`. Verify the owned object with:

```bash
sui client object 0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95 --json
```

Before recording, run these shell checks:

```bash
pnpm verify:first
pnpm address:inventory
pnpm deepbook:spot-check -- --all-addresses --dry-run
pnpm settle:sample
pnpm settle:vault
pnpm live:proof
pnpm hackathon:status
pnpm submission:check
pnpm demo:evidence
```

Current wallet status from `pnpm address:inventory`: active address `cool-dichroite` has `0.250509634` SUI plus `1999.999999` `STUDIO_LP`, with another `0.03517108` SUI on `distracted-garnet` and `0.19800212` SUI on `mystifying-epidote`. No local address has funded Predict dUSDC, funded DEEP, or funded dBUSDC; `mystifying-epidote` only has three zero-balance DEEP coin objects.

Current DeepBook Spot status is `blocked_missing_deep`: current DeepBook source requires 500 DEEP for permissionless pool creation, all six local Sui addresses have `0 funded DEEP`, and the live DEEP/SUI testnet pool only quoted 10 DEEP at about `0.2702` SUI while 50+ DEEP returned no liquidity. The checker now uses the official SDK testnet registry/package defaults; once DEEP is funded, `pnpm hackathon:status` devInspects `pool::create_permissionless_pool<STUDIO_LP, dUSDC>` and treats that as a valid secondary-market path even without a Cetus pool ID. Current sample and vault settlement status passes in `pnpm hackathon:status`.

After recording, set `DEMO_VIDEO_URL` in the live environment. `pnpm hackathon:status` keeps the demo gate blocked until that URL is recorded.
`pnpm demo:evidence` writes the current shell proof bundle to `docs/DEMO_EVIDENCE.md`.

## Talking Points

- Predict is long-only, so max loss is premium paid.
- The Move wrapper enforces `premium_paid <= max_loss_budget` atomically.
- The optimizer is guarded against bad SVI density, models sequential impact, and can exact-solve sparse baskets under the gas cap.
- Vault shares are transferable `Coin<STUDIO_LP>` objects even though Predict positions are account-bound inside a manager.
- PT/YT, collateral, RFQ, Kiosk royalty notes, Walrus specs, and sponsor hooks are composability layers around the share coin and the certified basket.
- Analytics are reproducible from the on-chain SVI surface and Predict preview functions.
- Live testnet deploy, manager funding, vault setup, two mints, sample settlement, and vault settlement have digests. Pyth and Walrus have fresh live smokes.
