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
9. Open positions and settle an expired receipt.
10. Run the backtest panel against settled `/oracles` data and show hit rate plus P&L distribution.

## Talking Points

- Predict is long-only, so max loss is premium paid.
- The Move wrapper enforces `premium_paid <= max_loss_budget` atomically.
- The optimizer is guarded against bad SVI density, models sequential impact, and can exact-solve sparse baskets under the gas cap.
- Vault shares are transferable `Coin<STUDIO_LP>` objects even though Predict positions are account-bound inside a manager.
- PT/YT, collateral, RFQ, Kiosk royalty notes, Walrus specs, and sponsor hooks are composability layers around the share coin and the certified basket.
- Analytics are reproducible from the on-chain SVI surface and Predict preview functions.
- Live testnet digest capture remains token-gated until the wallet has dUSDC and SUI.
