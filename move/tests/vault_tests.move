#[test_only]
module predict_studio::vault_tests {
    use predict_studio::vault;
    use sui::{coin, tx_context};

    #[test]
    fun first_deposit_mints_shares_and_sets_accounted_balance() {
        let mut ctx = tx_context::dummy();
        let mut v = vault::new_for_testing(&mut ctx);
        let dep = coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx);
        let shares = vault::deposit(&mut v, dep, &mut ctx);

        assert!(coin::value(&shares) > 0, 0);
        assert!(vault::accounted_assets(&v) == 1_000_000, 1);
        assert!(vault::total_shares(&v) > coin::value(&shares), 2);

        coin::burn_for_testing(shares);
        vault::destroy_for_testing(v);
    }

    #[test]
    fun donation_does_not_move_share_price() {
        let mut ctx = tx_context::dummy();
        let mut v = vault::new_for_testing(&mut ctx);
        let s1 = vault::deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            &mut ctx,
        );

        vault::donate_for_testing(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000_000, &mut ctx),
        );

        let s2 = vault::deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            &mut ctx,
        );
        let v1 = coin::value(&s1);
        let v2 = coin::value(&s2);
        assert!(v2 * 100 >= v1 * 99, 0);

        coin::burn_for_testing(s1);
        coin::burn_for_testing(s2);
        vault::destroy_for_testing(v);
    }

    #[test]
    fun pending_deposit_claims_after_processing() {
        let mut ctx = tx_context::dummy();
        let mut v = vault::new_for_testing(&mut ctx);
        let initial = vault::deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            &mut ctx,
        );
        vault::set_strategy_open_for_testing(&mut v, true);

        let receipt = vault::request_deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(2_000_000, &mut ctx),
            &mut ctx,
        );
        assert!(vault::pending_assets(&v) == 2_000_000, 0);
        vault::process_pending(&mut v);
        assert!(vault::current_epoch(&v) == 1, 1);
        assert!(vault::claimable_shares(&v) > 0, 2);

        let claimed = vault::claim(&mut v, receipt, &mut ctx);
        assert!(coin::value(&claimed) > 0, 3);
        assert!(vault::claimable_shares(&v) == 0, 4);

        coin::burn_for_testing(initial);
        coin::burn_for_testing(claimed);
        vault::destroy_for_testing(v);
    }

    #[test]
    fun high_water_mark_fee_mints_once() {
        let mut ctx = tx_context::dummy();
        let mut v = vault::new_for_testing(&mut ctx);
        let shares = vault::deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            &mut ctx,
        );
        let initial_hwm = vault::hwm_pps_num(&v);

        vault::set_accounted_assets_for_testing(&mut v, 2_000_000);
        let fee = vault::crystallize_fee(&mut v, &mut ctx);
        let fee_value = coin::value(&fee);
        assert!(fee_value > 0, 0);
        assert!(vault::hwm_pps_num(&v) > initial_hwm, 1);

        let fee2 = vault::crystallize_fee(&mut v, &mut ctx);
        assert!(coin::value(&fee2) == 0, 2);

        coin::burn_for_testing(shares);
        coin::burn_for_testing(fee);
        coin::burn_for_testing(fee2);
        vault::destroy_for_testing(v);
    }

    #[test]
    fun keeper_cap_processes_pending_deposits() {
        let mut ctx = tx_context::dummy();
        let mut v = vault::new_for_testing(&mut ctx);
        let receipt = vault::request_deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            &mut ctx,
        );
        let cap = vault::grant_keeper(&v, 1_000_000, &mut ctx);

        vault::keeper_roll(&mut v, &cap, 500_000);
        let claimed = vault::claim(&mut v, receipt, &mut ctx);
        assert!(coin::value(&claimed) > 0, 0);

        coin::burn_for_testing(claimed);
        vault::destroy_keeper_for_testing(cap);
        vault::destroy_for_testing(v);
    }

    #[test, expected_failure(abort_code = 8)]
    fun keeper_cap_rejects_wrong_vault() {
        let mut ctx = tx_context::dummy();
        let mut v1 = vault::new_for_testing(&mut ctx);
        let v2 = vault::new_for_testing(&mut ctx);
        let cap = vault::grant_keeper(&v2, 1, &mut ctx);
        vault::keeper_roll(&mut v1, &cap, 0);
        vault::destroy_keeper_for_testing(cap);
        vault::destroy_for_testing(v1);
        vault::destroy_for_testing(v2);
    }
}
