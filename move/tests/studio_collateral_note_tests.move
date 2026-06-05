#[test_only]
module predict_studio::studio_collateral_note_tests {
    use predict_studio::{studio, studio_collateral};
    use deepbook_predict::{
        i64,
        oracle::{Self as oracle, OracleSVI, OracleSVICap},
        plp::PLP,
        predict::{Self as predict, Predict},
        registry::{Self as predict_registry, AdminCap, Registry},
    };
    use std::string;
    use sui::test_scenario::{Self as test_scenario};
    use sui::{clock, coin, coin_registry, object, transfer};

    public struct TEST_USDC has key {
        id: UID,
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

    fun create_predict_and_oracle(
        scenario: &mut test_scenario::Scenario,
        admin: address,
    ): (ID, ID) {
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

        (predict_id, oracle_id)
    }

    fun activate_oracle(scenario: &mut test_scenario::Scenario, admin: address, oracle_id: ID) {
        scenario.next_tx(admin);
        {
            let admin_cap = scenario.take_from_sender<AdminCap>();
            let oracle_cap = scenario.take_from_sender<OracleSVICap>();
            let mut oracle = scenario.take_shared_by_id<OracleSVI>(oracle_id);
            let clock_obj = clock::create_for_testing(scenario.ctx());
            predict_registry::register_oracle_cap(&mut oracle, &admin_cap, &oracle_cap);
            oracle::activate(&mut oracle, &oracle_cap, &clock_obj);
            oracle::update_prices(
                &mut oracle,
                &oracle_cap,
                oracle::new_price_data(100_000, 100_000),
                &clock_obj,
            );
            oracle::update_svi(
                &mut oracle,
                &oracle_cap,
                oracle::new_svi_params(40_000_000, 100_000_000, i64::zero(), i64::zero(), 200_000_000),
                &clock_obj,
            );
            clock_obj.destroy_for_testing();
            scenario.return_to_sender(admin_cap);
            scenario.return_to_sender(oracle_cap);
            test_scenario::return_shared(oracle);
        };
    }

    /// A note whose oracle_id/expiry match the live oracle so `marked_value` prices it.
    fun make_note(oracle: &OracleSVI, ctx: &mut TxContext): studio::StructuredPosition {
        studio::new_for_testing_with_expiry(
            oracle::id(oracle),
            oracle::id(oracle),
            oracle::expiry(oracle),
            string::utf8(b"digital_call"),
            vector[studio::new_leg(false, true, 100_000, 0, 100_000)],
            50_000,
            ctx,
        )
    }

    #[test]
    fun borrows_against_note_marked_value_and_reclaims() {
        let system = @0x0;
        let admin = @0xA;
        let mut scenario = test_scenario::begin(system);
        create_test_currency(&mut scenario, system);
        let (predict_id, oracle_id) = create_predict_and_oracle(&mut scenario, admin);
        activate_oracle(&mut scenario, admin, oracle_id);

        scenario.next_tx(admin);
        {
            let mut predict = scenario.take_shared_by_id<Predict>(predict_id);
            let oracle = scenario.take_shared_by_id<OracleSVI>(oracle_id);
            let clock_obj = clock::create_for_testing(scenario.ctx());
            let plp = predict::supply<TEST_USDC>(
                &mut predict,
                coin::mint_for_testing<TEST_USDC>(5_000_000, scenario.ctx()),
                &clock_obj,
                scenario.ctx(),
            );
            coin::burn_for_testing(plp);

            let note = make_note(&oracle, scenario.ctx());
            let note_id = object::id(&note);
            let marked = studio::marked_value(&predict, &oracle, &note, &clock_obj);
            let ceiling = studio::max_payout_of(&note);
            let value = if (marked < ceiling) marked else ceiling;
            assert!(value > 0, 0);
            assert!(studio::provable_floor(&note) == 0, 1);

            let mut market = studio_collateral::new_note_market_for_testing<TEST_USDC>(5_000, scenario.ctx());
            studio_collateral::deposit_note_liquidity<TEST_USDC>(
                &mut market,
                coin::mint_for_testing<TEST_USDC>(10_000_000, scenario.ctx()),
            );
            let mut position = studio_collateral::open_note_position<TEST_USDC>(
                &market,
                note,
                &predict,
                &oracle,
                &clock_obj,
                scenario.ctx(),
            );

            let capacity = value * 5_000 / 10_000;
            assert!(studio_collateral::note_borrow_capacity(&position, &market) == capacity, 2);
            let borrowed = studio_collateral::borrow_note<TEST_USDC>(&mut market, &mut position, capacity, scenario.ctx());
            assert!(coin::value(&borrowed) == capacity, 3);
            studio_collateral::repay_note<TEST_USDC>(&mut market, &mut position, borrowed);
            assert!(studio_collateral::note_debt(&position) == 0, 4);

            let reclaimed = studio_collateral::close_note<TEST_USDC>(position, scenario.ctx());
            assert!(object::id(&reclaimed) == note_id, 5);

            studio::destroy_for_testing(reclaimed);
            studio_collateral::destroy_note_market_for_testing<TEST_USDC>(market);
            clock_obj.destroy_for_testing();
            test_scenario::return_shared(oracle);
            test_scenario::return_shared(predict);
        };
        scenario.end();
    }

    #[test, expected_failure(abort_code = 3)]
    fun note_borrow_aborts_above_capacity() {
        let system = @0x0;
        let admin = @0xA;
        let mut scenario = test_scenario::begin(system);
        create_test_currency(&mut scenario, system);
        let (predict_id, oracle_id) = create_predict_and_oracle(&mut scenario, admin);
        activate_oracle(&mut scenario, admin, oracle_id);

        scenario.next_tx(admin);
        {
            let mut predict = scenario.take_shared_by_id<Predict>(predict_id);
            let oracle = scenario.take_shared_by_id<OracleSVI>(oracle_id);
            let clock_obj = clock::create_for_testing(scenario.ctx());
            let plp = predict::supply<TEST_USDC>(
                &mut predict,
                coin::mint_for_testing<TEST_USDC>(5_000_000, scenario.ctx()),
                &clock_obj,
                scenario.ctx(),
            );
            coin::burn_for_testing(plp);

            let note = make_note(&oracle, scenario.ctx());
            let marked = studio::marked_value(&predict, &oracle, &note, &clock_obj);
            let ceiling = studio::max_payout_of(&note);
            let value = if (marked < ceiling) marked else ceiling;

            let mut market = studio_collateral::new_note_market_for_testing<TEST_USDC>(5_000, scenario.ctx());
            studio_collateral::deposit_note_liquidity<TEST_USDC>(
                &mut market,
                coin::mint_for_testing<TEST_USDC>(10_000_000, scenario.ctx()),
            );
            let mut position = studio_collateral::open_note_position<TEST_USDC>(
                &market,
                note,
                &predict,
                &oracle,
                &clock_obj,
                scenario.ctx(),
            );

            let over = value * 5_000 / 10_000 + 1;
            let borrowed = studio_collateral::borrow_note<TEST_USDC>(&mut market, &mut position, over, scenario.ctx());

            studio_collateral::repay_note<TEST_USDC>(&mut market, &mut position, borrowed);
            let reclaimed = studio_collateral::close_note<TEST_USDC>(position, scenario.ctx());
            studio::destroy_for_testing(reclaimed);
            studio_collateral::destroy_note_market_for_testing<TEST_USDC>(market);
            clock_obj.destroy_for_testing();
            test_scenario::return_shared(oracle);
            test_scenario::return_shared(predict);
        };
        scenario.end();
    }

    #[test, expected_failure(abort_code = 10)]
    fun note_borrow_aborts_when_settled() {
        let system = @0x0;
        let admin = @0xA;
        let mut scenario = test_scenario::begin(system);
        create_test_currency(&mut scenario, system);
        let (predict_id, oracle_id) = create_predict_and_oracle(&mut scenario, admin);
        activate_oracle(&mut scenario, admin, oracle_id);

        scenario.next_tx(admin);
        {
            let predict = scenario.take_shared_by_id<Predict>(predict_id);
            let oracle = scenario.take_shared_by_id<OracleSVI>(oracle_id);
            let clock_obj = clock::create_for_testing(scenario.ctx());

            let mut note = make_note(&oracle, scenario.ctx());
            studio::set_settled_for_testing(&mut note, true);

            let market = studio_collateral::new_note_market_for_testing<TEST_USDC>(5_000, scenario.ctx());
            let position = studio_collateral::open_note_position<TEST_USDC>(
                &market,
                note,
                &predict,
                &oracle,
                &clock_obj,
                scenario.ctx(),
            );

            let reclaimed = studio_collateral::close_note<TEST_USDC>(position, scenario.ctx());
            studio::destroy_for_testing(reclaimed);
            studio_collateral::destroy_note_market_for_testing<TEST_USDC>(market);
            clock_obj.destroy_for_testing();
            test_scenario::return_shared(oracle);
            test_scenario::return_shared(predict);
        };
        scenario.end();
    }
}
