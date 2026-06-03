#[test_only]
module predict_studio::pt_yt_tests {
    use predict_studio::{pt_yt, studio_lp::STUDIO_LP, vault};
    use deepbook_predict::{
        oracle::{Self as oracle, OracleSVI, OracleSVICap},
        plp::PLP,
        predict::Predict,
        registry::{Self as predict_registry, AdminCap, Registry},
    };
    use std::string;
    use sui::test_scenario::{Self as test_scenario};
    use sui::{clock, coin, coin_registry, transfer, tx_context};

    public struct TEST_USDC has key {
        id: UID,
    }

    fun minted_share(ctx: &mut tx_context::TxContext): (vault::StructuredVault<vault::DUSDC_T>, coin::Coin<STUDIO_LP>) {
        let mut v = vault::new_for_testing(ctx);
        let shares = vault::deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, ctx),
            ctx,
        );
        (v, shares)
    }

    fun create_test_currency(scenario: &mut test_scenario::Scenario, owner: address) {
        let mut coin_registry_obj = coin_registry::create_coin_data_registry_for_testing(scenario.ctx());
        let (currency_init, treasury_cap) = coin_registry::new_currency<TEST_USDC>(
            &mut coin_registry_obj,
            6,
            string::utf8(b"tUSDC"),
            string::utf8(b"Test USDC"),
            string::utf8(b"test quote"),
            string::utf8(b""),
            scenario.ctx(),
        );
        let metadata_cap = coin_registry::finalize(currency_init, scenario.ctx());
        coin_registry::share_for_testing(coin_registry_obj);
        transfer::public_transfer(treasury_cap, owner);
        transfer::public_transfer(metadata_cap, owner);
    }

    fun create_settled_oracle(scenario: &mut test_scenario::Scenario, admin: address): ID {
        let registry_id;
        scenario.next_tx(admin);
        {
            registry_id = predict_registry::init_for_testing(scenario.ctx());
        };

        let predict_id;
        scenario.next_tx(admin);
        {
            let mut registry = scenario.take_shared_by_id<Registry>(registry_id);
            let admin_cap = scenario.take_from_sender<AdminCap>();
            let currency = scenario.take_shared<coin_registry::Currency<TEST_USDC>>();
            let clock_obj = clock::create_for_testing(scenario.ctx());
            predict_id = predict_registry::create_predict<TEST_USDC>(
                &mut registry,
                &admin_cap,
                &currency,
                coin::create_treasury_cap_for_testing<PLP>(scenario.ctx()),
                &clock_obj,
                scenario.ctx(),
            );
            clock_obj.destroy_for_testing();
            scenario.return_to_sender(admin_cap);
            test_scenario::return_shared(currency);
            test_scenario::return_shared(registry);
        };

        let oracle_id;
        scenario.next_tx(admin);
        {
            let mut registry = scenario.take_shared_by_id<Registry>(registry_id);
            let mut predict = scenario.take_shared_by_id<Predict>(predict_id);
            let admin_cap = scenario.take_from_sender<AdminCap>();
            let oracle_cap = predict_registry::create_oracle_cap(&admin_cap, scenario.ctx());
            oracle_id = predict_registry::create_oracle(
                &mut registry,
                &mut predict,
                &admin_cap,
                &oracle_cap,
                string::utf8(b"BTC"),
                100_000,
                10_000,
                10_000,
                scenario.ctx(),
            );
            scenario.return_to_sender(admin_cap);
            transfer::public_transfer(oracle_cap, admin);
            test_scenario::return_shared(predict);
            test_scenario::return_shared(registry);
        };

        scenario.next_tx(admin);
        {
            let admin_cap = scenario.take_from_sender<AdminCap>();
            let oracle_cap = scenario.take_from_sender<OracleSVICap>();
            let mut oracle = scenario.take_shared_by_id<OracleSVI>(oracle_id);
            let mut clock_obj = clock::create_for_testing(scenario.ctx());
            predict_registry::register_oracle_cap(&mut oracle, &admin_cap, &oracle_cap);
            clock::set_for_testing(&mut clock_obj, 100_000);
            oracle::update_prices(
                &mut oracle,
                &oracle_cap,
                oracle::new_price_data(120_000, 120_000),
                &clock_obj,
            );
            clock_obj.destroy_for_testing();
            scenario.return_to_sender(admin_cap);
            scenario.return_to_sender(oracle_cap);
            test_scenario::return_shared(oracle);
        };

        oracle_id
    }

    #[test]
    fun split_and_merge_conserve_share_value() {
        let mut ctx = tx_context::dummy();
        let (v, shares) = minted_share(&mut ctx);
        let share_value = coin::value(&shares);
        let mut tranche = pt_yt::new_for_testing(8_000, &mut ctx);

        let (pt, yt) = pt_yt::split(&mut tranche, shares, &mut ctx);
        assert!(coin::value(&pt) == share_value, 0);
        assert!(coin::value(&yt) == share_value, 1);
        assert!(pt_yt::total_split(&tranche) == share_value, 2);

        let merged = pt_yt::merge(&mut tranche, pt, yt, &mut ctx);
        assert!(coin::value(&merged) == share_value, 3);
        assert!(pt_yt::total_split(&tranche) == 0, 4);

        coin::burn_for_testing(merged);
        pt_yt::destroy_for_testing(tranche);
        vault::destroy_for_testing(v);
    }

    #[test]
    fun settled_pt_and_yt_waterfall_conserves_payout() {
        let mut ctx = tx_context::dummy();
        let (v, shares) = minted_share(&mut ctx);
        let share_value = coin::value(&shares);
        let mut tranche = pt_yt::new_for_testing(8_000, &mut ctx);
        let (pt, yt) = pt_yt::split(&mut tranche, shares, &mut ctx);

        let payout_value = share_value * 9_000 / 10_000;
        pt_yt::settle_for_testing(
            &mut tranche,
            coin::mint_for_testing<vault::DUSDC_T>(payout_value, &mut ctx),
        );
        assert!(pt_yt::settled(&tranche), 0);

        let pt_assets = pt_yt::redeem_pt(&mut tranche, pt, &mut ctx);
        let yt_assets = pt_yt::redeem_yt(&mut tranche, yt, &mut ctx);
        assert!(coin::value(&pt_assets) + coin::value(&yt_assets) == payout_value, 1);
        assert!(coin::value(&pt_assets) == share_value * 8_000 / 10_000, 2);

        coin::burn_for_testing(pt_assets);
        coin::burn_for_testing(yt_assets);
        pt_yt::destroy_for_testing(tranche);
        vault::destroy_for_testing(v);
    }

    #[test]
    fun settle_tranche_with_settled_oracle_redeems_locked_shares() {
        let system = @0x0;
        let admin = @0xA;
        let mut scenario = test_scenario::begin(system);
        create_test_currency(&mut scenario, system);
        let oracle_id = create_settled_oracle(&mut scenario, admin);

        scenario.next_tx(admin);
        {
            let oracle = scenario.take_shared_by_id<OracleSVI>(oracle_id);
            let clock_obj = clock::create_for_testing(scenario.ctx());
            let (mut v, shares) = minted_share(scenario.ctx());
            let share_value = coin::value(&shares);
            let expected_payout = vault::share_value(&v, share_value);
            let mut tranche = pt_yt::new_for_testing(8_000, scenario.ctx());
            let (pt, yt) = pt_yt::split(&mut tranche, shares, scenario.ctx());

            pt_yt::settle_tranche(&mut tranche, &mut v, &oracle, &clock_obj, scenario.ctx());
            assert!(pt_yt::settled(&tranche), 0);

            let pt_assets = pt_yt::redeem_pt(&mut tranche, pt, scenario.ctx());
            let yt_assets = pt_yt::redeem_yt(&mut tranche, yt, scenario.ctx());
            assert!(coin::value(&pt_assets) + coin::value(&yt_assets) == expected_payout, 1);
            assert!(coin::value(&pt_assets) >= coin::value(&yt_assets), 2);

            coin::burn_for_testing(pt_assets);
            coin::burn_for_testing(yt_assets);
            clock_obj.destroy_for_testing();
            pt_yt::destroy_for_testing(tranche);
            vault::destroy_for_testing(v);
            test_scenario::return_shared(oracle);
        };
        scenario.end();
    }
}
