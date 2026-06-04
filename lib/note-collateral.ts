/**
 * Note-backed borrow math — mirrors `studio_collateral::note_collateral_value` on-chain.
 *
 * Honest framing: a long-only structured note pays in `[0, maxPayout]`. Its chain-provable
 * floor is therefore 0 (it can expire worthless), and its chain-provable ceiling is
 * `maxPayout`. We lend against the *live redeemable bid* (`markedValue`), never above the
 * ceiling, at a conservative LTV — a reclaim bridge, not leverage. Max loss on the note
 * stays the premium paid; the borrow is repaid to reclaim the escrowed note.
 */
export interface NoteBorrowInputs {
  /** Live redeemable bid of the note (sum of Predict bid quotes), in quote units. */
  markedValue: number;
  /** Provable ceiling = `studio::max_payout(legs)`, in quote units. */
  maxPayout: number;
  /** Loan-to-value in basis points (e.g. 5000 = 50%). */
  ltvBps: number;
}

export interface NoteBorrowTerms {
  provableFloor: 0;
  provableCeiling: number;
  liveMark: number;
  /** Collateral basis actually used: min(mark, ceiling). */
  collateralValue: number;
  /** Max borrowable: ltv * collateralValue. Never exceeds ltv * ceiling. */
  capacity: number;
  ltvBps: number;
}

const BPS = 10_000;

export function noteBorrowTerms({ markedValue, maxPayout, ltvBps }: NoteBorrowInputs): NoteBorrowTerms {
  const mark = Math.max(0, Math.floor(markedValue));
  const ceiling = Math.max(0, Math.floor(maxPayout));
  const ltv = Math.max(0, Math.min(BPS, Math.floor(ltvBps)));
  const collateralValue = Math.min(mark, ceiling);
  const capacity = Math.floor((collateralValue * ltv) / BPS);
  return {
    provableFloor: 0,
    provableCeiling: ceiling,
    liveMark: mark,
    collateralValue,
    capacity,
    ltvBps: ltv,
  };
}
