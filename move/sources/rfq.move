module predict_studio::rfq {
    use std::string::String;
    use predict_studio::studio;
    use std::bcs;
    use sui::{
        address,
        clock::{Self, Clock},
        ed25519,
        hash,
        object::{Self, UID},
        table::{Self, Table},
        tx_context::TxContext,
    };

    const EBadSig: u64 = 1;
    const EExpired: u64 = 2;
    const ENonceUsed: u64 = 3;
    const EStructureHashMismatch: u64 = 4;
    const EBadMaker: u64 = 5;

    const ED25519_SCHEME_FLAG: u8 = 0;

    public struct RfqBook has key, store {
        id: UID,
        used_quotes: Table<vector<u8>, bool>,
    }

    public struct Quote has copy, drop, store {
        structure_hash: vector<u8>,
        premium: u64,
        maker: address,
        expiry_ms: u64,
        nonce: u64,
    }

    public fun new(ctx: &mut TxContext): RfqBook {
        RfqBook { id: object::new(ctx), used_quotes: table::new(ctx) }
    }

    public fun new_quote(
        structure_hash: vector<u8>,
        premium: u64,
        maker: address,
        expiry_ms: u64,
        nonce: u64,
    ): Quote {
        Quote { structure_hash, premium, maker, expiry_ms, nonce }
    }

    public fun quote_message(quote: &Quote): vector<u8> {
        bcs::to_bytes(quote)
    }

    public fun quote_key(quote: &Quote): vector<u8> {
        hash::blake2b256(&quote_message(quote))
    }

    public fun ed25519_address(public_key: vector<u8>): address {
        let mut bytes = vector[ED25519_SCHEME_FLAG];
        bytes.append(public_key);
        address::from_bytes(hash::blake2b256(&bytes))
    }

    public fun used(book: &RfqBook, quote: &Quote): bool {
        let key = quote_key(quote);
        table::contains(&book.used_quotes, key)
    }

    public fun verify_and_mark(
        book: &mut RfqBook,
        quote: Quote,
        public_key: vector<u8>,
        signature: vector<u8>,
        clock: &Clock,
    ): u64 {
        assert!(clock::timestamp_ms(clock) <= quote.expiry_ms, EExpired);
        let msg = quote_message(&quote);
        assert!(ed25519::ed25519_verify(&signature, &public_key, &msg), EBadSig);
        assert!(ed25519_address(public_key) == quote.maker, EBadMaker);
        let key = hash::blake2b256(&msg);
        assert!(!table::contains(&book.used_quotes, key), ENonceUsed);
        table::add(&mut book.used_quotes, key, true);
        quote.premium
    }

    public fun verify_structure_and_mark(
        book: &mut RfqBook,
        quote: Quote,
        structure_hash: vector<u8>,
        public_key: vector<u8>,
        signature: vector<u8>,
        clock: &Clock,
    ): u64 {
        assert!(quote.structure_hash == structure_hash, EStructureHashMismatch);
        verify_and_mark(book, quote, public_key, signature, clock)
    }

    public fun fill_quote<QuoteAsset>(
        book: &mut RfqBook,
        predict: &mut deepbook_predict::predict::Predict,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        oracle: &deepbook_predict::oracle::OracleSVI,
        shape: String,
        legs: vector<studio::Leg>,
        quote: Quote,
        public_key: vector<u8>,
        signature: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): studio::StructuredPosition {
        let structure_hash = studio::structure_hash(&shape, &legs);
        let premium = verify_structure_and_mark(book, quote, structure_hash, public_key, signature, clock);
        studio::build_and_mint<QuoteAsset>(
            predict,
            manager,
            oracle,
            shape,
            legs,
            premium,
            clock,
            ctx,
        )
    }

    #[test_only]
    public fun destroy_for_testing(book: RfqBook) {
        let RfqBook { id, used_quotes } = book;
        table::drop(used_quotes);
        object::delete(id);
    }
}
