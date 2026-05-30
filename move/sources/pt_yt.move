module predict_studio::pt_yt {
    use predict_studio::{studio_lp::STUDIO_LP, vault::DUSDC_T};
    use sui::{
        balance::{Self, Balance},
        coin::{Self, Coin, TreasuryCap},
        object::{Self, UID},
        tx_context::TxContext,
    };

    const EZeroAmount: u64 = 1;
    const EMismatchedTranches: u64 = 2;
    const EAlreadySettled: u64 = 3;
    const ENotSettled: u64 = 4;
    const EInsufficientPool: u64 = 5;

    public struct PT has drop {}
    public struct YT has drop {}

    public struct TrancheVault has key, store {
        id: UID,
        locked_shares: Balance<STUDIO_LP>,
        payout_pool: Balance<DUSDC_T>,
        pt_treasury: TreasuryCap<PT>,
        yt_treasury: TreasuryCap<YT>,
        total_split: u64,
        settlement_bps: u64,
        floor_bps: u64,
        settled: bool,
    }

    public fun split(
        v: &mut TrancheVault,
        shares: Coin<STUDIO_LP>,
        ctx: &mut TxContext,
    ): (Coin<PT>, Coin<YT>) {
        assert!(!v.settled, EAlreadySettled);
        let amount = coin::value(&shares);
        assert!(amount > 0, EZeroAmount);
        balance::join(&mut v.locked_shares, coin::into_balance(shares));
        v.total_split = v.total_split + amount;
        (
            coin::mint(&mut v.pt_treasury, amount, ctx),
            coin::mint(&mut v.yt_treasury, amount, ctx),
        )
    }

    public fun merge(
        v: &mut TrancheVault,
        pt: Coin<PT>,
        yt: Coin<YT>,
        ctx: &mut TxContext,
    ): Coin<STUDIO_LP> {
        assert!(!v.settled, EAlreadySettled);
        let pt_value = coin::value(&pt);
        let yt_value = coin::value(&yt);
        assert!(pt_value == yt_value, EMismatchedTranches);
        coin::burn(&mut v.pt_treasury, pt);
        coin::burn(&mut v.yt_treasury, yt);
        v.total_split = v.total_split - pt_value;
        coin::take(&mut v.locked_shares, pt_value, ctx)
    }

    public fun redeem_pt(v: &mut TrancheVault, pt: Coin<PT>, ctx: &mut TxContext): Coin<DUSDC_T> {
        assert!(v.settled, ENotSettled);
        let amount = coin::value(&pt);
        let claim_bps = min_u64(v.floor_bps, v.settlement_bps);
        let claim = amount * claim_bps / 10_000;
        assert!(claim <= balance::value(&v.payout_pool), EInsufficientPool);
        coin::burn(&mut v.pt_treasury, pt);
        coin::take(&mut v.payout_pool, claim, ctx)
    }

    public fun redeem_yt(v: &mut TrancheVault, yt: Coin<YT>, ctx: &mut TxContext): Coin<DUSDC_T> {
        assert!(v.settled, ENotSettled);
        let amount = coin::value(&yt);
        let claim_bps = if (v.settlement_bps > v.floor_bps) {
            v.settlement_bps - v.floor_bps
        } else {
            0
        };
        let claim = amount * claim_bps / 10_000;
        assert!(claim <= balance::value(&v.payout_pool), EInsufficientPool);
        coin::burn(&mut v.yt_treasury, yt);
        coin::take(&mut v.payout_pool, claim, ctx)
    }

    public fun total_split(v: &TrancheVault): u64 { v.total_split }

    public fun settled(v: &TrancheVault): bool { v.settled }

    fun min_u64(a: u64, b: u64): u64 {
        if (a < b) a else b
    }

    #[test_only]
    public fun new_for_testing(floor_bps: u64, ctx: &mut TxContext): TrancheVault {
        TrancheVault {
            id: object::new(ctx),
            locked_shares: balance::zero<STUDIO_LP>(),
            payout_pool: balance::zero<DUSDC_T>(),
            pt_treasury: coin::create_treasury_cap_for_testing<PT>(ctx),
            yt_treasury: coin::create_treasury_cap_for_testing<YT>(ctx),
            total_split: 0,
            settlement_bps: 0,
            floor_bps,
            settled: false,
        }
    }

    #[test_only]
    public fun settle_for_testing(v: &mut TrancheVault, payout: Coin<DUSDC_T>) {
        assert!(!v.settled, EAlreadySettled);
        let payout_value = coin::value(&payout);
        v.settlement_bps = if (v.total_split == 0) {
            0
        } else {
            payout_value * 10_000 / v.total_split
        };
        balance::join(&mut v.payout_pool, coin::into_balance(payout));
        v.settled = true;
    }

    #[test_only]
    public fun destroy_for_testing(v: TrancheVault) {
        let TrancheVault {
            id,
            locked_shares,
            payout_pool,
            pt_treasury,
            yt_treasury,
            total_split: _,
            settlement_bps: _,
            floor_bps: _,
            settled: _,
        } = v;
        balance::destroy_for_testing(locked_shares);
        balance::destroy_for_testing(payout_pool);
        std::unit_test::destroy(pt_treasury);
        std::unit_test::destroy(yt_treasury);
        object::delete(id);
    }
}
