# Demo Script — Predict Studio (5:00 video)

Shot-by-shot, narrated script for the submission video. Timecodes are targets — practice 3× to land under 5:00. **Every on-chain claim maps to a real recorded digest (see Live Testnet Proof below); show the explorer, don't just assert it.** Narration is the spoken track; bracketed lines are on-screen actions.

**Before you hit record:** `pnpm verify:first` · `pnpm live:proof` · `pnpm collateral:demo` · `pnpm hackathon:status` · `pnpm dev`, with a Sui testnet explorer tab open. **Gasless lane:** if `NEXT_PUBLIC_ENOKI_API_KEY` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `ENOKI_PRIVATE_KEY` are set, run the `/buy` gasless flow live; if not, narrate gasless as the onboarding design and use the wallet mint as the on-chain proof — the mint digest is real either way. Do **not** claim a gasless buy you didn't execute on camera.

### [00:00–00:35] Problem — the $100M gap
- [On screen: title card → the landing hero with the English IntentBar.]
- "On-chain options have been stuck at about a hundred million dollars in total value for years — the sponsor's own words are 'not a competitive market, an underdeveloped one.' Yet the same traders pushed seven-point-three-five *trillion* through perp DEXs last year, and Polymarket cleared seven billion in a single month. The demand isn't missing. The problem is that building an options payoff — choosing strikes, legs, and sizes — is something normal people will never do. Predict Studio fixes exactly that."

### [00:35–01:00] Solution — one sentence
- [On screen: type into the IntentBar — `BTC above $66k by Friday, pays $100`. Pause on the **"Parsed by Claude"** chip.]
- "You describe a market view in plain English. Claude parses it — see the tag — and Predict Studio turns it into a fairly priced, defined-risk note. Your worst case is the premium you pay, enforced on-chain. Watch."
- **Prompt tip — IMPORTANT for the live mint:** mint a **one-sided digital** ("above $X" / "below $X") — it's a single Predict leg and mints cleanly on-chain. *Range* notes ("between $X and $Y") draw a nicer curve but currently abort on-chain (a multi-leg `decrease_position` netting path), so keep ranges to the preview/curve beats only and mint the one-sided note. The engine honors the exact strike you type; read the on-screen premium/max-loss aloud rather than pre-scripting a number (it tracks live spot/IV).

### [01:00–02:00] The note — and proof it's real options math
- [On screen: generated note — payoff curve (a step up at your strike), premium, max loss, max gain, Greeks. Then open the Solver Inspector, then the Replication-Proof panel.]
- "Here's the note — a defined-risk BTC call. The premium and the max loss are the *same number*: whatever this note costs is the absolute most I can lose, capped on-chain. The payoff curve, the Greeks, the implied probability — all computed off Block Scholes' own on-chain oracle, the exact surface Predict settles against. Nothing here is a toy model."
- [Solver Inspector] "The solver replicates the same payoff across different leg budgets — it repairs unsafe volatility slices, then exact-solves the cheapest sparse basket under the gas cap."
- [Replication-Proof panel] "And this is the core claim: this note is exactly these Predict legs, minted in *one* programmable transaction — spreads become a question of UX, not infrastructure."

### [02:00–03:00] Mint it — live, on-chain
- [On screen: connect wallet `0x89c2…338a` → the Trading Account shows the funded manager with ~$5,000 dUSDC. Gasless is off (Enoki not configured). Click **Mint Max Loss $…** → wallet signs → success → open the explorer on the new digest and the owned StructuredPosition.]
- "I mint it. One PTB builds the leg atomically from the funded trading account and hands me an owned StructuredPosition receipt — live on testnet, on package `0xad53…7758f`. The Move wrapper enforced `premium ≤ max-loss budget` inside that same transaction. Real position, real package — not a mock."
- **Proven-live fresh mint (fallback if a mint aborts on camera):** digest `jx2yRhW5ZzyGrgFar7ABUL7GKNadvVnySz9sD6qb2Jz`, position `0x1fe771ac…0b45e9`, premium/max-loss **$18.42**, max-gain **$100** ("pays $100 above $66k"). The original sample `7AHeK1…` / `0x1fd7…` is also real — both resolve in the explorer.

### [03:00–03:45] Settlement — defined risk, proven both ways
- [On screen: Positions panel → settled receipts; explorer on the two settle digests.]
- "Now the part that earns trust — settlement. This sample note expired out of the money: payout zero, and the loss stopped exactly at the premium paid, not a cent more — digest `3bafsw…`. And a vault-rolled position that expired *in* the money paid out for a positive P&L — digest `7cGNws…`. Wins and losses both settle on-chain against the oracle, with the downside capped by construction."

### [03:45–04:25] Depth — it's a factory, not a form (the `/advanced` builder)
- [On screen: open `/advanced` and fan through — Template/Catalog picker, Solver Inspector, Borrow (K2), Owned positions; then vault NAV vs secondary, PT/YT split, creator leaderboard + Walrus share, backtest.]
- "This is the builder under the hood — same engine, full control. Pick a shape visually — capped bull, strangle, range, peak — or one of twelve pre-built products, and set the payout scale."
- [Solver Inspector] "The inspector shows the same payoff solved three ways across leg budgets, and what the gas-bounded sparse solve *saves* versus a dense replication — that 'Saved' number is real."
- [Borrow / K2] "Lock the note as collateral and borrow dUSDC against its provable on-chain value, then repay to reclaim it — a builder *and* a mini prime-broker."
- "And one receipt becomes a whole stack: a transferable vault share coin even though the Predict legs underneath are account-bound, principal-and-yield tranches, an RFQ fill, a Kiosk resale paying a royalty onto the creator leaderboard, a Walrus-published spec a friend buys in two taps. Every analytic, including this backtest, is reproducible from the on-chain surface."

### [04:25–05:00] Why Sui · roadmap · close
- [On screen: back to the hero / a clean summary card.]
- "Why Sui: account-bound Predict positions inside a funded manager, transferable receipts and vault shares as first-class objects, and the entire multi-leg build settling atomically in one PTB — that composition isn't clean anywhere else. Today this runs on Predict's testnet; our config shim makes the mainnet deploy a one-line flip, and we deliberately keep Margin leverage out of scope so 'max loss = premium' stays true. Predict Studio: type a sentence, get a defined-risk on-chain option. That's how the next hundred million in this category actually gets built."

---

> **Checklist version** (if you prefer to free-narrate over the same beats): oracle panel → `verify:first` gates → IntentBar note → solver inspector → replication-proof → mint (digest + owned position) → settlement digests → vault/NAV/PT-YT/creator/Walrus share → backtest → mainnet-shim + Margin-roadmap close.

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
fresh mint:       jx2yRhW5ZzyGrgFar7ABUL7GKNadvVnySz9sD6qb2Jz  ("pays $100 above $66k", premium/max-loss $18.42, max-gain $100)
fresh position:   0x1fe771ac38ab76d8074f96a844684332986f4166f2fed84302e220bccc0b45e9
demo oracle:      0x3453193b0c8b1ba4ca22495cdc0f4552d93c6f402ebdbf6505056edae9bfcff7  (BTC, expiry Fri 26 Jun 08:00 UTC)
```

> **Live-mint note:** mint **one-sided digital** notes ("above $X" / "below $X") on camera — a single Predict leg that mints cleanly (proven by `jx2yRhW5…` above). Range notes ("between $X and $Y") render a richer curve for the preview but currently abort on-chain in `predict_manager::decrease_position` (multi-leg netting), so keep ranges to the preview beats only.

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
pnpm collateral:demo
pnpm hackathon:status
pnpm submission:check
pnpm demo:evidence
```

Current wallet status from `pnpm address:inventory`: active address `cool-dichroite` has `65.113914016` SUI, `0.037513` Predict dUSDC, and `1999.999999` `STUDIO_LP`, with another `0.03517108` SUI on `distracted-garnet` and `0.19800212` SUI on `mystifying-epidote`. No local address has funded DEEP or funded dBUSDC; `mystifying-epidote` only has three zero-balance DEEP coin objects.

Current DeepBook Spot status is `blocked_missing_deep`: current DeepBook source requires 500 DEEP for permissionless pool creation, all six local Sui addresses have `0 funded DEEP`, and the live DEEP/SUI testnet pool only quoted 10 DEEP at about `0.2244` SUI while 50+ DEEP returned no liquidity. The checker now uses the official SDK testnet registry/package defaults; once DEEP is funded, `pnpm hackathon:status` devInspects `pool::create_permissionless_pool<STUDIO_LP, dUSDC>` and treats that as a valid secondary-market path even without a Cetus pool ID. Current sample, vault settlement, and K2 collateral proof status pass in `pnpm hackathon:status`.

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
