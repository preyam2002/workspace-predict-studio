module predict_studio::rfq {
    use std::string::String;
    use predict_studio::studio;
    use std::bcs;
    use sui::{
        clock::{Self, Clock},
        ed25519,
        hash,
        object::{Self, UID},
        tx_context::TxContext,
    };

    const EBadSig: u64 = 1;
    const EExpired: u64 = 2;
    const ENonceUsed: u64 = 3;
    const EStructureHashMismatch: u64 = 4;

    public struct RfqBook has key, store {
        id: UID,
        used_quotes: vector<vector<u8>>,
    }

    public struct Quote has copy, drop, store {
        structure_hash: vector<u8>,
        premium: u64,
        maker: address,
        expiry_ms: u64,
        nonce: u64,
    }

    public fun new(ctx: &mut TxContext): RfqBook {
        RfqBook { id: object::new(ctx), used_quotes: vector[] }
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

    public fun used(book: &RfqBook, quote: &Quote): bool {
        let key = quote_key(quote);
        let mut i = 0;
        while (i < book.used_quotes.length()) {
            if (book.used_quotes[i] == key) return true;
            i = i + 1;
        };
        false
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
        assert!(!used(book, &quote), ENonceUsed);
        book.used_quotes.push_back(hash::blake2b256(&msg));
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
        let RfqBook { id, used_quotes: _ } = book;
        object::delete(id);
    }
}
