#[test_only]
module predict_studio::studio_collateral_tests {
    use predict_studio::{studio_collateral, studio_lp::STUDIO_LP, vault};
    use sui::{coin, tx_context};

    fun share(ctx: &mut tx_context::TxContext): (vault::StructuredVault<vault::DUSDC_T>, coin::Coin<STUDIO_LP>) {
        let mut v = vault::new_for_testing(ctx);
        let s = vault::deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, ctx),
            ctx,
        );
        (v, s)
    }

    #[test]
    fun borrows_against_provable_floor_and_releases_after_repay() {
        let mut ctx = tx_context::dummy();
        let (v, s) = share(&mut ctx);
        let mut market = studio_collateral::new_for_testing(5_000, &mut ctx);
        studio_collateral::deposit_liquidity(
            &mut market,
            coin::mint_for_testing<vault::DUSDC_T>(10_000_000, &mut ctx),
        );
        let mut position = studio_collateral::open_position(&mut market, s, 800_000, &mut ctx);

        assert!(studio_collateral::borrow_capacity(&position, &market) == 400_000, 0);
        let borrowed = studio_collateral::borrow(&mut market, &mut position, 300_000, &mut ctx);
        assert!(coin::value(&borrowed) == 300_000, 1);
        assert!(studio_collateral::health_bps(&position, &market) > 10_000, 2);
        studio_collateral::repay(&mut market, &mut position, borrowed);
        assert!(studio_collateral::debt(&position) == 0, 3);

        let returned = studio_collateral::close(&mut market, position, &mut ctx);
        coin::burn_for_testing(returned);
        studio_collateral::destroy_for_testing(market);
        vault::destroy_for_testing(v);
    }

    #[test, expected_failure(abort_code = 3)]
    fun borrow_aborts_above_floor_ltv_capacity() {
        let mut ctx = tx_context::dummy();
        let (v, s) = share(&mut ctx);
        let mut market = studio_collateral::new_for_testing(5_000, &mut ctx);
        studio_collateral::deposit_liquidity(
            &mut market,
            coin::mint_for_testing<vault::DUSDC_T>(10_000_000, &mut ctx),
        );
        let mut position = studio_collateral::open_position(&mut market, s, 800_000, &mut ctx);
        let borrowed = studio_collateral::borrow(&mut market, &mut position, 400_001, &mut ctx);
        studio_collateral::repay(&mut market, &mut position, borrowed);
        let returned = studio_collateral::close(&mut market, position, &mut ctx);
        coin::burn_for_testing(returned);
        studio_collateral::destroy_for_testing(market);
        vault::destroy_for_testing(v);
    }
}
