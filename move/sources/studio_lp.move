module predict_studio::studio_lp {
    use std::option;
    use sui::{
        coin::{Self, TreasuryCap},
        object::{Self, UID},
        transfer,
        tx_context::{Self, TxContext},
    };

    public struct STUDIO_LP has drop {}

    public struct ShareFactory has key, store {
        id: UID,
        share_treasury: TreasuryCap<STUDIO_LP>,
    }

    #[allow(deprecated_usage)]
    fun init(witness: STUDIO_LP, ctx: &mut TxContext) {
        let (share_treasury, metadata) = coin::create_currency(
            witness,
            6,
            b"STUDIO-LP",
            b"Predict Studio LP",
            b"Tokenized Predict Studio vault share",
            option::none(),
            ctx,
        );
        transfer::public_freeze_object(metadata);
        transfer::public_transfer(
            ShareFactory { id: object::new(ctx), share_treasury },
            tx_context::sender(ctx),
        );
    }

    public fun id(factory: &ShareFactory): ID {
        object::id(factory)
    }

    public(package) fun into_treasury(factory: ShareFactory): TreasuryCap<STUDIO_LP> {
        let ShareFactory { id, share_treasury } = factory;
        object::delete(id);
        share_treasury
    }

    #[test_only]
    public fun new_factory_for_testing(ctx: &mut TxContext): ShareFactory {
        ShareFactory {
            id: object::new(ctx),
            share_treasury: coin::create_treasury_cap_for_testing<STUDIO_LP>(ctx),
        }
    }
}
