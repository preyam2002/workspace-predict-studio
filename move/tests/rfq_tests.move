#[test_only]
module predict_studio::rfq_tests {
    use predict_studio::rfq;
    use sui::{clock, tx_context};

    const STRUCTURE_HASH: vector<u8> = x"315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3";
    const MAKER: address = @0x7573c697fa68450f04fa0dee2d39dcdc8a5ccf5db547f3e47638a6f8eeeec110;
    const PUBLIC_KEY: vector<u8> = x"79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664";
    const SIGNATURE: vector<u8> = x"76b380b15313e531cce87e0931c3af85425a7fffe11c280d8cb57302992959a3d0be4810e34f4b66968ee9cf5fcc5b2dac31672a8c5c4f163e142dfe1b9fe70c";
    const UNBOUND_PUBLIC_KEY: vector<u8> = x"ada773b3703c2518f7e61b492df4a74aa8fb7e20fac262bdc21f1924943eae2b";
    const UNBOUND_SIGNATURE: vector<u8> = x"5536177dd361fee73a16d04604767397f944e057870f2765d70e7b7ff20a961a75c90eea8577191fdf43a8c144bfb98053f635c378f4ebb6148082660e9b2509";

    fun signed_quote(): rfq::Quote {
        rfq::new_quote(STRUCTURE_HASH, 1_000_000, MAKER, 999_999_999, 42)
    }

    #[test]
    fun valid_signed_quote_marks_nonce_used() {
        let mut ctx = tx_context::dummy();
        let mut book = rfq::new(&mut ctx);
        let clock = clock::create_for_testing(&mut ctx);
        let premium = rfq::verify_and_mark(&mut book, signed_quote(), PUBLIC_KEY, SIGNATURE, &clock);
        assert!(premium == 1_000_000, 0);
        assert!(rfq::used(&book, &signed_quote()), 1);
        clock::destroy_for_testing(clock);
        rfq::destroy_for_testing(book);
    }

    #[test, expected_failure(abort_code = 3)]
    fun replayed_quote_aborts() {
        let mut ctx = tx_context::dummy();
        let mut book = rfq::new(&mut ctx);
        let clock = clock::create_for_testing(&mut ctx);
        rfq::verify_and_mark(&mut book, signed_quote(), PUBLIC_KEY, SIGNATURE, &clock);
        rfq::verify_and_mark(&mut book, signed_quote(), PUBLIC_KEY, SIGNATURE, &clock);
        clock::destroy_for_testing(clock);
        rfq::destroy_for_testing(book);
    }

    #[test, expected_failure(abort_code = 1)]
    fun tampered_premium_aborts_bad_sig() {
        let mut ctx = tx_context::dummy();
        let mut book = rfq::new(&mut ctx);
        let clock = clock::create_for_testing(&mut ctx);
        let quote = rfq::new_quote(STRUCTURE_HASH, 1_000_001, @0xAA, 999_999_999, 42);
        rfq::verify_and_mark(&mut book, quote, PUBLIC_KEY, SIGNATURE, &clock);
        clock::destroy_for_testing(clock);
        rfq::destroy_for_testing(book);
    }

    #[test, expected_failure(abort_code = 4)]
    fun mismatched_structure_hash_aborts() {
        let mut ctx = tx_context::dummy();
        let mut book = rfq::new(&mut ctx);
        let clock = clock::create_for_testing(&mut ctx);
        rfq::verify_structure_and_mark(&mut book, signed_quote(), x"00", PUBLIC_KEY, SIGNATURE, &clock);
        clock::destroy_for_testing(clock);
        rfq::destroy_for_testing(book);
    }

    #[test, expected_failure(abort_code = 5)]
    fun wrong_maker_for_public_key_aborts() {
        let mut ctx = tx_context::dummy();
        let mut book = rfq::new(&mut ctx);
        let clock = clock::create_for_testing(&mut ctx);
        let quote = rfq::new_quote(STRUCTURE_HASH, 1_000_000, @0xAA, 999_999_999, 42);
        rfq::verify_and_mark(&mut book, quote, UNBOUND_PUBLIC_KEY, UNBOUND_SIGNATURE, &clock);
        clock::destroy_for_testing(clock);
        rfq::destroy_for_testing(book);
    }

    #[test, expected_failure(abort_code = 2)]
    fun expired_quote_aborts() {
        let mut ctx = tx_context::dummy();
        let mut book = rfq::new(&mut ctx);
        let mut clock = clock::create_for_testing(&mut ctx);
        clock::set_for_testing(&mut clock, 1_000_000_000);
        rfq::verify_and_mark(&mut book, signed_quote(), PUBLIC_KEY, SIGNATURE, &clock);
        clock::destroy_for_testing(clock);
        rfq::destroy_for_testing(book);
    }
}
