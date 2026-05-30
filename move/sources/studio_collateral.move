module predict_studio::studio_collateral {
    use predict_studio::{studio_lp::STUDIO_LP, vault::DUSDC_T};
    use sui::{
        balance::{Self, Balance},
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
        collateral: Coin<STUDIO_LP>,
        floor_value: u64,
        ctx: &mut TxContext,
    ): BorrowPosition {
        let shares = coin::value(&collateral);
        assert!(shares > 0, EZeroCollateral);
        assert!(floor_value > 0, EZeroFloor);
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
