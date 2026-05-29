# Demo Script

Target length: 5 minutes.

1. Connect wallet and show the BTC Predict oracle panel: spot, forward, strike tick, expiry, and SVI sigma.
2. Pick Capped Bull, set strike near spot, max loss near `$50`, payoff near `$200`.
3. Show the payoff chart, max loss, max gain, EV, and optimizer savings.
4. Move the spot and SVI sigma sliders; the payoff and analytics update immediately.
5. Mint the structure with one PTB; show the digest and the owned `StructuredPosition`.
6. Open positions and settle an expired receipt.
7. Run the backtest panel against settled `/oracles` data and show hit rate plus P&L distribution.

## Talking Points

- Predict is long-only, so max loss is premium paid.
- The Move wrapper enforces `premium_paid <= max_loss_budget` atomically.
- The optimizer picks the cheapest equivalent long-only decomposition and ties by leg count.
- Analytics are reproducible from the on-chain SVI surface and Predict preview functions.
- This is a builder/terminal, not a vault.
