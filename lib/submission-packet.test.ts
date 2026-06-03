import { describe, expect, it } from 'vitest';
import { validateSubmissionPacket } from './submission-packet';

const completePacket = `
# DeepSurge Submission Packet

## Project
**Name:** Predict Studio
**Primary track:** DeepBook Predict
**Secondary track:** DeFi
**Tagline:** The structured-note factory and marketplace on DeepBook Predict.

## Short Description
Predict Studio turns DeepBook Predict's raw binary and range instruments into retail-legible structured notes.

## Problem
On-chain options are still a roughly $100M TVL category because payoff construction is too hard for normal users.

## Why Sui And DeepBook
DeepBook Predict gives Sui-native binary and range markets with oracle-settled payoffs.

## Technical Highlights
- Long-only replication means max loss equals premium by construction.
- Vault NAV is oracle-marked across open Predict legs, not cash-only.

## Live Proof
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

## Demo Flow
1. Type a BTC market view in English.

## Current Disclosures
- Enoki gasless lane is implemented but live smoke needs credentials.
- Secondary market is implemented with Cetus/mock fallback.
- Predict is testnet-only today.
- pnpm hackathon:status remains blocked until DEMO_VIDEO_URL and DEEPSURGE_SUBMISSION_URL are recorded.

## Verification Commands
pnpm verify:first
pnpm address:inventory
pnpm deepbook:spot-check -- --all-addresses --dry-run
pnpm settle:sample
pnpm settle:vault
pnpm live:proof
pnpm hackathon:status
pnpm submission:check
pnpm demo:evidence
pnpm vitest run
pnpm build
MOVE_HOME=$(mktemp -d) sui move test -p move
`;

describe('DeepSurge submission packet verifier', () => {
  it('accepts a packet with required sections, live proof, disclosures, and commands', () => {
    expect(validateSubmissionPacket(completePacket)).toEqual({ ok: true, missing: [] });
  });

  it('rejects packets that omit the repo-correct Move test command', () => {
    const result = validateSubmissionPacket(completePacket.replace('sui move test -p move', 'sui move test'));

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('command: MOVE_HOME=$(mktemp -d) sui move test -p move');
  });

  it('rejects packets that omit the submission packet check command', () => {
    const result = validateSubmissionPacket(completePacket.replace('pnpm submission:check\n', ''));

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('command: pnpm submission:check');
  });

  it('rejects packets that omit the demo evidence bundle command', () => {
    const result = validateSubmissionPacket(completePacket.replace('pnpm demo:evidence\n', ''));

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('command: pnpm demo:evidence');
  });
});
