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
        transfer,
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

    // ============================================================
    // Share-backed market (vault `Coin<STUDIO_LP>` collateral).
    // ============================================================

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
        floor_value: u64,
        debt: u64,
    }

    public fun liquidity(market: &CollateralMarket): u64 { balance::value(&market.liquidity) }

    public fun total_debt(market: &CollateralMarket): u64 { market.total_debt }

    public fun ltv_bps(market: &CollateralMarket): u64 { market.ltv_bps }

    public fun debt(position: &BorrowPosition): u64 { position.debt }

    public fun new(ltv_bps: u64, ctx: &mut TxContext): CollateralMarket {
        CollateralMarket {
            id: object::new(ctx),
            liquidity: balance::zero<DUSDC_T>(),
            locked_collateral: balance::zero<STUDIO_LP>(),
            ltv_bps,
            total_debt: 0,
        }
    }

    public entry fun create_and_share_market(ltv_bps: u64, ctx: &mut TxContext) {
        transfer::public_share_object(new(ltv_bps, ctx));
    }

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
            floor_value,
            debt: 0,
        }
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
        let BorrowPosition { id, market_id: _, owner, collateral_shares, floor_value: _, debt } = position;
        assert!(tx_context::sender(ctx) == owner, ENotOwner);
        assert!(debt == 0, EStillDebt);
        object::delete(id);
        coin::take(&mut market.locked_collateral, collateral_shares, ctx)
    }

    // ============================================================
    // Note-backed market (the K2 prime-broker path).
    //
    // Generic over the quote coin `Q` so it can hold the *real* dUSDC on-chain
    // (the share market above is typed on the phantom `DUSDC_T`). Capacity =
    // `ltv * min(live marked bid, max_payout)`, computed on-chain from the oracle
    // so it cannot be inflated and never exceeds the provable ceiling. The note is
    // escrowed and returned verbatim by `close_note` once debt clears. This is a
    // defined-risk reclaim bridge, not leverage: a long-only note's chain-provable
    // floor is 0, so we lend against the live mark; max loss stays the premium paid.
    // ============================================================

    public struct NoteCollateralMarket<phantom Q> has key, store {
        id: UID,
        liquidity: Balance<Q>,
        ltv_bps: u64,
        total_debt: u64,
    }

    public struct NoteBorrow<phantom Q> has key, store {
        id: UID,
        market_id: ID,
        owner: address,
        note: Option<StructuredPosition>,
        floor_value: u64,
        debt: u64,
    }

    public fun note_liquidity<Q>(market: &NoteCollateralMarket<Q>): u64 { balance::value(&market.liquidity) }

    public fun note_market_total_debt<Q>(market: &NoteCollateralMarket<Q>): u64 { market.total_debt }

    public fun note_market_ltv<Q>(market: &NoteCollateralMarket<Q>): u64 { market.ltv_bps }

    public fun note_debt<Q>(position: &NoteBorrow<Q>): u64 { position.debt }

    public fun new_note_market<Q>(ltv_bps: u64, ctx: &mut TxContext): NoteCollateralMarket<Q> {
        NoteCollateralMarket { id: object::new(ctx), liquidity: balance::zero<Q>(), ltv_bps, total_debt: 0 }
    }

    public entry fun create_and_share_note_market<Q>(ltv_bps: u64, ctx: &mut TxContext) {
        transfer::public_share_object(new_note_market<Q>(ltv_bps, ctx));
    }

    public fun deposit_note_liquidity<Q>(market: &mut NoteCollateralMarket<Q>, coin: Coin<Q>) {
        balance::join(&mut market.liquidity, coin::into_balance(coin));
    }

    /// Provable collateral value of a note: live redeemable bid (`marked_value`),
    /// capped by the chain-provable ceiling `max_payout`. Read on-chain, so a
    /// borrower cannot inflate it.
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

    public fun note_borrow_capacity<Q>(position: &NoteBorrow<Q>, market: &NoteCollateralMarket<Q>): u64 {
        position.floor_value * market.ltv_bps / BPS
    }

    public fun note_health_bps<Q>(position: &NoteBorrow<Q>, market: &NoteCollateralMarket<Q>): u64 {
        if (position.debt == 0) return std::u64::max_value!();
        note_borrow_capacity(position, market) * BPS / position.debt
    }

    /// Lock an owned note as collateral and open a borrow against its provable value.
    public fun open_note_position<Q>(
        market: &NoteCollateralMarket<Q>,
        note: StructuredPosition,
        predict: &Predict,
        oracle: &OracleSVI,
        clock: &Clock,
        ctx: &mut TxContext,
    ): NoteBorrow<Q> {
        assert!(studio::owner(&note) == tx_context::sender(ctx), ENoteNotOwner);
        assert!(!studio::is_settled(&note), ENoteSettled);
        let value = note_collateral_value(&note, predict, oracle, clock);
        assert!(value > 0, EZeroFloor);
        NoteBorrow {
            id: object::new(ctx),
            market_id: object::id(market),
            owner: tx_context::sender(ctx),
            note: option::some(note),
            floor_value: value,
            debt: 0,
        }
    }

    public fun borrow_note<Q>(
        market: &mut NoteCollateralMarket<Q>,
        position: &mut NoteBorrow<Q>,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<Q> {
        assert!(tx_context::sender(ctx) == position.owner, ENotOwner);
        assert!(position.debt + amount <= note_borrow_capacity(position, market), EExceedsCapacity);
        assert!(amount <= balance::value(&market.liquidity), EInsufficientLiquidity);
        position.debt = position.debt + amount;
        market.total_debt = market.total_debt + amount;
        coin::take(&mut market.liquidity, amount, ctx)
    }

    public fun repay_note<Q>(market: &mut NoteCollateralMarket<Q>, position: &mut NoteBorrow<Q>, payment: Coin<Q>) {
        let amount = coin::value(&payment);
        assert!(amount <= position.debt, EOverRepay);
        position.debt = position.debt - amount;
        market.total_debt = market.total_debt - amount;
        balance::join(&mut market.liquidity, coin::into_balance(payment));
    }

    /// Repay-to-reclaim: return the escrowed note verbatim once debt is zero.
    public fun close_note<Q>(position: NoteBorrow<Q>, ctx: &mut TxContext): StructuredPosition {
        let NoteBorrow { id, market_id: _, owner, mut note, floor_value: _, debt } = position;
        assert!(tx_context::sender(ctx) == owner, ENotOwner);
        assert!(debt == 0, EStillDebt);
        assert!(option::is_some(&note), EWrongCollateralKind);
        object::delete(id);
        let recovered = option::extract(&mut note);
        option::destroy_none(note);
        recovered
    }

    #[test_only]
    public fun new_for_testing(ltv_bps: u64, ctx: &mut TxContext): CollateralMarket {
        new(ltv_bps, ctx)
    }

    #[test_only]
    public fun destroy_for_testing(market: CollateralMarket) {
        let CollateralMarket { id, liquidity, locked_collateral, ltv_bps: _, total_debt: _ } = market;
        balance::destroy_for_testing(liquidity);
        balance::destroy_for_testing(locked_collateral);
        object::delete(id);
    }

    #[test_only]
    public fun new_note_market_for_testing<Q>(ltv_bps: u64, ctx: &mut TxContext): NoteCollateralMarket<Q> {
        new_note_market<Q>(ltv_bps, ctx)
    }

    #[test_only]
    public fun destroy_note_market_for_testing<Q>(market: NoteCollateralMarket<Q>) {
        let NoteCollateralMarket { id, liquidity, ltv_bps: _, total_debt: _ } = market;
        balance::destroy_for_testing(liquidity);
        object::delete(id);
    }
}
