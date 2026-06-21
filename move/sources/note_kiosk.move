module predict_studio::note_kiosk {
    use sui::{
        coin::{Self, Coin},
        event,
        kiosk::{Self, Kiosk, KioskOwnerCap},
        object::{Self, UID},
        package::{Self, Publisher},
        sui::SUI,
        transfer,
        transfer_policy::{Self as policy, TransferPolicy, TransferPolicyCap, TransferRequest},
        tx_context::{Self, TxContext},
    };

    /// One-time witness so the package can claim a `Publisher`, which is required to create a
    /// `TransferPolicy<StudioNote>` (the missing piece that made the kiosk unusable before).
    public struct NOTE_KIOSK has drop {}

    fun init(otw: NOTE_KIOSK, ctx: &mut TxContext) {
        transfer::public_transfer(package::claim(otw, ctx), tx_context::sender(ctx));
    }

    const EFeeTooHigh: u64 = 1;
    const EInsufficientRoyalty: u64 = 2;

    const MAX_ROYALTY_BPS: u16 = 1_000;

    public struct StudioNote has key, store {
        id: UID,
        structure_hash: vector<u8>,
        publisher: address,
        premium_paid: u64,
        maturity_ms: u64,
        royalty_bps: u16,
    }

    public struct RoyaltyRule has drop {}

    public struct RoyaltyConfig has drop, store {
        bps: u16,
        publisher: address,
    }

    public struct NoteMinted has copy, drop {
        note_id: ID,
        publisher: address,
        premium_paid: u64,
        maturity_ms: u64,
        royalty_bps: u16,
    }

    public struct RoyaltyPaid has copy, drop {
        note_id: ID,
        amount: u64,
        publisher: address,
    }

    public fun new_note(
        structure_hash: vector<u8>,
        publisher: address,
        premium_paid: u64,
        maturity_ms: u64,
        royalty_bps: u16,
        ctx: &mut TxContext,
    ): StudioNote {
        assert!(royalty_bps <= MAX_ROYALTY_BPS, EFeeTooHigh);
        let note = StudioNote {
            id: object::new(ctx),
            structure_hash,
            publisher,
            premium_paid,
            maturity_ms,
            royalty_bps,
        };
        event::emit(NoteMinted {
            note_id: object::id(&note),
            publisher,
            premium_paid,
            maturity_ms,
            royalty_bps,
        });
        note
    }

    public fun id(note: &StudioNote): ID { object::id(note) }

    public fun publisher(note: &StudioNote): address { note.publisher }

    public fun premium_paid(note: &StudioNote): u64 { note.premium_paid }

    public fun maturity_ms(note: &StudioNote): u64 { note.maturity_ms }

    public fun royalty_bps(note: &StudioNote): u16 { note.royalty_bps }

    public fun structure_hash(note: &StudioNote): &vector<u8> { &note.structure_hash }

    public fun set_royalty(
        transfer_policy: &mut TransferPolicy<StudioNote>,
        cap: &TransferPolicyCap<StudioNote>,
        bps: u16,
        publisher: address,
    ) {
        assert!(bps <= MAX_ROYALTY_BPS, EFeeTooHigh);
        policy::add_rule(RoyaltyRule {}, transfer_policy, cap, RoyaltyConfig { bps, publisher })
    }

    public fun new_policy(pub: &Publisher, ctx: &mut TxContext): (TransferPolicy<StudioNote>, TransferPolicyCap<StudioNote>) {
        policy::new<StudioNote>(pub, ctx)
    }

    /// Production setup: create the StudioNote transfer policy with the royalty rule, share
    /// the policy so anyone can resolve a sale, and hand the policy cap to the publisher.
    public fun create_and_share_policy(pub: &Publisher, bps: u16, royalty_recipient: address, ctx: &mut TxContext) {
        let (mut transfer_policy, cap) = new_policy(pub, ctx);
        set_royalty(&mut transfer_policy, &cap, bps, royalty_recipient);
        transfer::public_share_object(transfer_policy);
        transfer::public_transfer(cap, tx_context::sender(ctx));
    }

    public fun pay_royalty(
        transfer_policy: &mut TransferPolicy<StudioNote>,
        request: &mut TransferRequest<StudioNote>,
        payment: &mut Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        let (bps, publisher) = {
            let cfg: &RoyaltyConfig = policy::get_rule(RoyaltyRule {}, transfer_policy);
            (cfg.bps, cfg.publisher)
        };
        let amount = ((policy::paid(request) as u128) * (bps as u128) / 10_000) as u64;
        assert!(coin::value(payment) >= amount, EInsufficientRoyalty);

        if (amount > 0) {
            let fee = coin::split(payment, amount, ctx);
            policy::add_to_balance(RoyaltyRule {}, transfer_policy, fee);
        };
        policy::add_receipt(RoyaltyRule {}, request);
        event::emit(RoyaltyPaid {
            note_id: policy::item(request),
            amount,
            publisher,
        });
    }

    public fun lock_note(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        transfer_policy: &TransferPolicy<StudioNote>,
        note: StudioNote,
    ) {
        kiosk::lock<StudioNote>(kiosk, cap, transfer_policy, note)
    }

    #[test_only]
    public fun otw_for_testing(): NOTE_KIOSK { NOTE_KIOSK {} }

    #[test_only]
    public fun destroy_note_for_testing(note: StudioNote) {
        let StudioNote {
            id,
            structure_hash: _,
            publisher: _,
            premium_paid: _,
            maturity_ms: _,
            royalty_bps: _,
        } = note;
        object::delete(id);
    }
}
