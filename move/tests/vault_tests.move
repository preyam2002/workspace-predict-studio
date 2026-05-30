#[test_only]
module predict_studio::vault_tests {
    use predict_studio::studio;
    use predict_studio::vault;
    use deepbook_predict::{predict, predict_manager::PredictManager};
    use std::string;
    use sui::test_scenario::{Self as test_scenario};
    use sui::{coin, object, tx_context};

    #[test]
    fun factory_creates_depositable_production_vault() {
        let mut ctx = tx_context::dummy();
        let factory = vault::new_factory_for_testing(&mut ctx);
        let mut v = vault::create_vault<vault::DUSDC_T>(
            factory,
            @0xA,
            1,
            1_000,
            string::utf8(b"prod"),
            &mut ctx,
        );
        let dep = coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx);
        let shares = vault::deposit(&mut v, dep, &mut ctx);

        assert!(coin::value(&shares) > 0, 0);
        assert!(vault::accounted_assets(&v) == 1_000_000, 1);

        coin::burn_for_testing(shares);
        vault::destroy_for_testing(v);
    }

    #[test]
    fun factory_create_and_share_vault_transfers_shared_object() {
        let sender = @0xA;
        let mut scenario = test_scenario::begin(sender);
        let vault_id;
        {
            let factory = vault::new_factory_for_testing(scenario.ctx());
            vault_id = vault::create_and_share_vault<vault::DUSDC_T>(
                factory,
                sender,
                1,
                1_000,
                string::utf8(b"shared"),
                scenario.ctx(),
            );
        };

        scenario.next_tx(sender);
        {
            let mut v = scenario.take_shared_by_id<vault::StructuredVault<vault::DUSDC_T>>(vault_id);
            let shares = vault::deposit(
                &mut v,
                coin::mint_for_testing<vault::DUSDC_T>(1_000_000, scenario.ctx()),
                scenario.ctx(),
            );
            assert!(coin::value(&shares) > 0, 0);
            coin::burn_for_testing(shares);
            test_scenario::return_shared(v);
        };
        scenario.end();
    }

    #[test]
    fun factory_can_share_vault_and_bind_manager_escrow_in_one_call() {
        let sender = @0xA;
        let mut scenario = test_scenario::begin(sender);
        let manager_id;
        {
            manager_id = predict::create_manager(scenario.ctx());
        };

        let vault_id;
        scenario.next_tx(sender);
        {
            let factory = vault::new_factory_for_testing(scenario.ctx());
            let manager = scenario.take_shared_by_id<PredictManager>(manager_id);
            let escrow = vault::create_and_share_vault_with_manager_escrow<vault::DUSDC_T>(
                factory,
                &manager,
                1,
                1_000,
                string::utf8(b"shared"),
                scenario.ctx(),
            );
            vault_id = vault::escrow_vault_id(&escrow);
            assert!(vault::escrow_manager_id(&escrow) == manager_id, 0);
            vault::destroy_manager_escrow_for_testing(escrow);
            test_scenario::return_shared(manager);
        };

        scenario.next_tx(sender);
        {
            let mut v = scenario.take_shared_by_id<vault::StructuredVault<vault::DUSDC_T>>(vault_id);
            let shares = vault::deposit(
                &mut v,
                coin::mint_for_testing<vault::DUSDC_T>(1_000_000, scenario.ctx()),
                scenario.ctx(),
            );
            assert!(coin::value(&shares) > 0, 1);
            coin::burn_for_testing(shares);
            test_scenario::return_shared(v);
        };
        scenario.end();
    }

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
    fun deposit_with_publisher_splits_capped_fee_and_preserves_zero_fee_path() {
        let mut ctx = tx_context::dummy();
        let mut v = vault::new_for_testing(&mut ctx);
        let (shares, fee, publisher) = vault::deposit_with_publisher(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            @0xB,
            10,
            &mut ctx,
        );
        assert!(publisher == @0xB, 0);
        assert!(coin::value(&fee) == 1_000, 1);
        assert!(vault::accounted_assets(&v) == 999_000, 2);

        let (shares2, fee2, publisher2) = vault::deposit_with_publisher(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            @0x0,
            0,
            &mut ctx,
        );
        assert!(publisher2 == @0x0, 3);
        assert!(coin::value(&fee2) == 0, 4);

        coin::burn_for_testing(shares);
        coin::burn_for_testing(fee);
        coin::burn_for_testing(shares2);
        coin::burn_for_testing(fee2);
        vault::destroy_for_testing(v);
    }

    #[test, expected_failure(abort_code = 10)]
    fun deposit_with_publisher_rejects_fee_above_cap() {
        let mut ctx = tx_context::dummy();
        let mut v = vault::new_for_testing(&mut ctx);
        let (shares, fee, _) = vault::deposit_with_publisher(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, &mut ctx),
            @0xB,
            11,
            &mut ctx,
        );
        coin::burn_for_testing(shares);
        coin::burn_for_testing(fee);
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

    #[test]
    fun manager_escrow_binds_signer_owned_predict_manager() {
        let admin = @0xA;
        let mut scenario = test_scenario::begin(admin);
        let manager_id;
        {
            manager_id = predict::create_manager(scenario.ctx());
        };

        scenario.next_tx(admin);
        {
            let v = vault::new_for_testing(scenario.ctx());
            let manager = scenario.take_shared_by_id<PredictManager>(manager_id);
            let escrow = vault::create_manager_escrow(&v, &manager, scenario.ctx());

            assert!(vault::escrow_vault_id(&escrow) == object::id(&v), 0);
            assert!(vault::escrow_manager_id(&escrow) == manager_id, 1);
            assert!(vault::escrow_owner(&escrow) == admin, 2);

            vault::assert_escrowed_manager(&v, &escrow, &manager, scenario.ctx());
            vault::destroy_manager_escrow_for_testing(escrow);
            test_scenario::return_shared(manager);
            vault::destroy_for_testing(v);
        };
        scenario.end();
    }

    #[test]
    fun vault_records_escrowed_strategy_position() {
        let admin = @0xA;
        let mut scenario = test_scenario::begin(admin);
        let manager_id;
        {
            manager_id = predict::create_manager(scenario.ctx());
        };

        scenario.next_tx(admin);
        {
            let mut v = vault::new_for_testing(scenario.ctx());
            let manager = scenario.take_shared_by_id<PredictManager>(manager_id);
            let escrow = vault::create_manager_escrow(&v, &manager, scenario.ctx());
            let position = studio::new_for_testing(
                manager_id,
                object::id(&v),
                string::utf8(b"test_strategy"),
                vector[studio::new_leg(false, true, 70_000, 0, 1_000_000)],
                123_000,
                scenario.ctx(),
            );

            vault::record_open_position(&mut v, &escrow, &manager, position, scenario.ctx());

            assert!(vault::strategy_is_open(&v), 0);
            assert!(vault::open_premium_paid(&v) == 123_000, 1);

            vault::destroy_manager_escrow_for_testing(escrow);
            test_scenario::return_shared(manager);
            vault::destroy_for_testing(v);
        };
        scenario.end();
    }

    #[test, expected_failure(abort_code = 11)]
    fun vault_rejects_strategy_position_from_wrong_manager() {
        let admin = @0xA;
        let mut scenario = test_scenario::begin(admin);
        let manager_id;
        {
            manager_id = predict::create_manager(scenario.ctx());
        };

        scenario.next_tx(admin);
        {
            let mut v = vault::new_for_testing(scenario.ctx());
            let manager = scenario.take_shared_by_id<PredictManager>(manager_id);
            let escrow = vault::create_manager_escrow(&v, &manager, scenario.ctx());
            let position = studio::new_for_testing(
                object::id(&v),
                object::id(&v),
                string::utf8(b"wrong_manager"),
                vector[studio::new_leg(false, true, 70_000, 0, 1_000_000)],
                123_000,
                scenario.ctx(),
            );

            vault::record_open_position(&mut v, &escrow, &manager, position, scenario.ctx());

            vault::destroy_manager_escrow_for_testing(escrow);
            test_scenario::return_shared(manager);
            vault::destroy_for_testing(v);
        };
        scenario.end();
    }

    #[test, expected_failure(abort_code = 12)]
    fun manager_escrow_rejects_manager_owned_by_different_sender() {
        let admin = @0xA;
        let operator = @0xB;
        let mut scenario = test_scenario::begin(operator);
        let manager_id;
        {
            manager_id = predict::create_manager(scenario.ctx());
        };

        scenario.next_tx(admin);
        {
            let v = vault::new_for_testing(scenario.ctx());
            let manager = scenario.take_shared_by_id<PredictManager>(manager_id);
            let escrow = vault::create_manager_escrow(&v, &manager, scenario.ctx());
            vault::destroy_manager_escrow_for_testing(escrow);
            test_scenario::return_shared(manager);
            vault::destroy_for_testing(v);
        };
        scenario.end();
    }
}
