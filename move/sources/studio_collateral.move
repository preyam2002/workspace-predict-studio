module predict_studio::studio_collateral {
    use predict_studio::{
        studio::{Self, StructuredPosition},
        studio_lp::STUDIO_LP,
        vault::{Self as vault, DUSDC_T},
    };
    use deepbook_predict::{oracle::OracleSVI, predict::Predict};
    use std::option::{Self, Option};
    use sui::{
        balance::{Self, Balance},
        clock::Clock,
        coin::{Self, Coin},
        object::{Self, UID},
        tx_context::{Self, TxContext},
    };

    const BPS: u64 = 10_000;

    const EZeroCollateral: u64 = 1;
    const EZeroFloor: u64 = 2;
    const EExceedsCapacity: u64 = 3;
    const EInsufficientLiquidity: u64 = 4;
    const ENotOwner: u64 = 5;
    const EStillDebt: u64 = 6;
    const EOverRepay: u64 = 7;
    const EFloorTooHigh: u64 = 8;
    const EVaultNotIdle: u64 = 9;
    const ENoteSettled: u64 = 10;
    const ENoteNotOwner: u64 = 11;
    const EWrongCollateralKind: u64 = 12;

    public struct CollateralMarket has key, store {
        id: UID,
        liquidity: Balance<DUSDC_T>,
        locked_collateral: Balance<STUDIO_LP>,
        ltv_bps: u64,
        total_debt: u64,
    }

    public struct BorrowPosition has key, store {
        id: UID,
        market_id: ID,
        owner: address,
        collateral_shares: u64,
        /// Set for note-backed borrows; `none` for the share-backed path.
        note: Option<StructuredPosition>,
        floor_value: u64,
        debt: u64,
    }

    public fun liquidity(market: &CollateralMarket): u64 { balance::value(&market.liquidity) }

    public fun total_debt(market: &CollateralMarket): u64 { market.total_debt }

    public fun debt(position: &BorrowPosition): u64 { position.debt }

    public fun borrow_capacity(position: &BorrowPosition, market: &CollateralMarket): u64 {
        position.floor_value * market.ltv_bps / BPS
    }

    public fun health_bps(position: &BorrowPosition, market: &CollateralMarket): u64 {
        if (position.debt == 0) return std::u64::max_value!();
        borrow_capacity(position, market) * BPS / position.debt
    }

    public fun deposit_liquidity(market: &mut CollateralMarket, coin: Coin<DUSDC_T>) {
        balance::join(&mut market.liquidity, coin::into_balance(coin));
    }

    public fun open_position(
        market: &mut CollateralMarket,
        vault: &vault::StructuredVault<DUSDC_T>,
        collateral: Coin<STUDIO_LP>,
        floor_value: u64,
        ctx: &mut TxContext,
    ): BorrowPosition {
        let shares = coin::value(&collateral);
        assert!(shares > 0, EZeroCollateral);
        assert!(floor_value > 0, EZeroFloor);
        assert!(
            !vault::strategy_is_open(vault) && !vault::has_open_position(vault) && vault::manager_cash(vault) == 0,
            EVaultNotIdle,
        );
        assert!(floor_value <= vault::share_value(vault, shares), EFloorTooHigh);
        balance::join(&mut market.locked_collateral, coin::into_balance(collateral));
        BorrowPosition {
            id: object::new(ctx),
            market_id: object::id(market),
            owner: tx_context::sender(ctx),
            collateral_shares: shares,
            note: option::none(),
            floor_value,
            debt: 0,
        }
    }

    /// Provable collateral value of a note: its live redeemable bid (`marked_value`),
    /// capped by the chain-provable ceiling `max_payout`. Never over-credits the
    /// best case, and is computed on-chain from the oracle so a borrower can't inflate it.
    public fun note_collateral_value(
        note: &StructuredPosition,
        predict: &Predict,
        oracle: &OracleSVI,
        clock: &Clock,
    ): u64 {
        let marked = studio::marked_value(predict, oracle, note, clock);
        let ceiling = studio::max_payout_of(note);
        if (marked < ceiling) marked else ceiling
    }

    /// Lock an owned `StructuredPosition` as collateral and open a borrow against it.
    /// Capacity = `ltv * min(marked_bid, max_payout)`. The note is escrowed inside the
    /// `BorrowPosition` and handed back verbatim by `close_note` once debt is cleared.
    /// This is a reclaim bridge, not leverage: `max loss` on the note stays the premium
    /// paid, and a settled note is rejected (no borrowing once it can resolve).
    public fun open_note_position(
        market: &CollateralMarket,
        note: StructuredPosition,
        predict: &Predict,
        oracle: &OracleSVI,
        clock: &Clock,
        ctx: &mut TxContext,
    ): BorrowPosition {
        assert!(studio::owner(&note) == tx_context::sender(ctx), ENoteNotOwner);
        assert!(!studio::is_settled(&note), ENoteSettled);
        let value = note_collateral_value(&note, predict, oracle, clock);
        assert!(value > 0, EZeroFloor);
        BorrowPosition {
            id: object::new(ctx),
            market_id: object::id(market),
            owner: tx_context::sender(ctx),
            collateral_shares: 0,
            note: option::some(note),
            floor_value: value,
            debt: 0,
        }
    }

    /// Repay-to-reclaim: return the escrowed note verbatim once debt is zero.
    public fun close_note(
        position: BorrowPosition,
        ctx: &mut TxContext,
    ): StructuredPosition {
        let BorrowPosition { id, market_id: _, owner, collateral_shares: _, mut note, floor_value: _, debt } = position;
        assert!(tx_context::sender(ctx) == owner, ENotOwner);
        assert!(debt == 0, EStillDebt);
        assert!(option::is_some(&note), EWrongCollateralKind);
        object::delete(id);
        let recovered = option::extract(&mut note);
        option::destroy_none(note);
        recovered
    }

    public fun borrow(
        market: &mut CollateralMarket,
        position: &mut BorrowPosition,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<DUSDC_T> {
        assert!(tx_context::sender(ctx) == position.owner, ENotOwner);
        assert!(position.debt + amount <= borrow_capacity(position, market), EExceedsCapacity);
        assert!(amount <= balance::value(&market.liquidity), EInsufficientLiquidity);
        position.debt = position.debt + amount;
        market.total_debt = market.total_debt + amount;
        coin::take(&mut market.liquidity, amount, ctx)
    }

    public fun repay(market: &mut CollateralMarket, position: &mut BorrowPosition, payment: Coin<DUSDC_T>) {
        let amount = coin::value(&payment);
        assert!(amount <= position.debt, EOverRepay);
        position.debt = position.debt - amount;
        market.total_debt = market.total_debt - amount;
        balance::join(&mut market.liquidity, coin::into_balance(payment));
    }

    public fun close(
        market: &mut CollateralMarket,
        position: BorrowPosition,
        ctx: &mut TxContext,
    ): Coin<STUDIO_LP> {
        let BorrowPosition { id, market_id: _, owner, collateral_shares, note, floor_value: _, debt } = position;
        assert!(tx_context::sender(ctx) == owner, ENotOwner);
        assert!(debt == 0, EStillDebt);
        assert!(option::is_none(&note), EWrongCollateralKind);
        option::destroy_none(note);
        object::delete(id);
        coin::take(&mut market.locked_collateral, collateral_shares, ctx)
    }

    #[test_only]
    public fun new_for_testing(ltv_bps: u64, ctx: &mut TxContext): CollateralMarket {
        CollateralMarket {
            id: object::new(ctx),
            liquidity: balance::zero<DUSDC_T>(),
            locked_collateral: balance::zero<STUDIO_LP>(),
            ltv_bps,
            total_debt: 0,
        }
    }

    #[test_only]
    public fun destroy_for_testing(market: CollateralMarket) {
        let CollateralMarket { id, liquidity, locked_collateral, ltv_bps: _, total_debt: _ } = market;
        balance::destroy_for_testing(liquidity);
        balance::destroy_for_testing(locked_collateral);
        object::delete(id);
    }
}
