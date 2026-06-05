/**
 * K2 prime-broker proof: the live mint -> lock-note -> borrow -> repay -> reclaim
 * loop, captured on Sui testnet. Prints the recorded digests from deploy.json and
 * the exact reproduction commands.
 *
 * The loop ran against a fresh full-package publish (core + K2 note-lending). The
 * note market is generic over the quote coin, so it holds the *real* deepbook dUSDC.
 *
 * Run: pnpm collateral:demo
 */
import { existsSync, readFileSync } from 'node:fs';

if (!existsSync('./deploy.json')) throw new Error('deploy.json missing');
const k2 = (JSON.parse(readFileSync('./deploy.json', 'utf8')) as { k2_note_lending?: Record<string, string> }).k2_note_lending;
if (!k2) throw new Error('deploy.json has no k2_note_lending block — run the live loop first');

const line = (label: string, value: string) => console.log(`${label.padEnd(22)} ${value}`);

console.log('K2 note-backed lending — live testnet proof\n');
line('package', k2.collateralPackageId);
line('note market', k2.noteCollateralMarketId);
line('  dUSDC type', k2.dusdcType);
line('  LTV', `${Number(k2.ltvBps) / 100}%`);
console.log('');
line('create market', k2.marketCreateDigest);
line('seed (withdraw)', `${k2.seedWithdrawDigest}  (${Number(k2.seedDusdc) / 1e6} dUSDC)`);
line('mint+lock+borrow', `${k2.mintBorrowDigest}  (one PTB, borrowed ${Number(k2.borrowedDusdc) / 1e6} dUSDC)`);
line('  noteBorrow', k2.noteBorrowId);
line('repay+reclaim', k2.repayReclaimDigest);
line('  reclaimed note', k2.reclaimedNoteId);
console.log('\nVerify any digest: sui client tx-block <digest>');

/*
 * Reproduction (testnet CLI; PKG/MARKET/PREDICT/ORACLE/MANAGER from deploy.json + an active oracle):
 *
 * 1) create + share a real-dUSDC market:
 *    sui client call --package $PKG --module studio_collateral --function create_and_share_note_market \
 *      --type-args $DUSDC --args 5000
 *
 * 2) seed it from the funded manager (withdraw -> deposit):
 *    sui client ptb \
 *      --move-call $DBP::predict_manager::withdraw "<$DUSDC>" @$MANAGER 2000000 --assign c \
 *      --transfer-objects "[c]" @$ME
 *    sui client call --package $PKG --module studio_collateral --function deposit_note_liquidity \
 *      --type-args $DUSDC --args $MARKET $COIN
 *
 * 3) mint a defined-risk note + lock it + borrow against its provable value, in ONE PTB
 *    (pick a strike inside the oracle grid whose ask clears [min_ask, max_ask]):
 *    sui client ptb \
 *      --move-call $PKG::studio::new_leg false false 64000000000000 0 10000 --assign leg \
 *      --make-move-vec "<$PKG::studio::Leg>" "[leg]" --assign legs \
 *      --move-call $PKG::studio::build_and_mint "<$DUSDC>" @$PREDICT @$MANAGER @$ORACLE '"digital_put"' legs 10000 @0x6 --assign note \
 *      --move-call $PKG::studio_collateral::open_note_position "<$DUSDC>" @$MARKET note @$PREDICT @$ORACLE @0x6 --assign pos \
 *      --move-call $PKG::studio_collateral::borrow_note "<$DUSDC>" @$MARKET pos 1000 --assign borrowed \
 *      --transfer-objects "[borrowed, pos]" @$ME
 *
 * 4) repay -> reclaim the escrowed note verbatim:
 *    sui client ptb \
 *      --move-call $PKG::studio_collateral::repay_note "<$DUSDC>" @$MARKET @$NB @$COIN \
 *      --move-call $PKG::studio_collateral::close_note "<$DUSDC>" @$NB --assign note \
 *      --transfer-objects "[note]" @$ME
 */
