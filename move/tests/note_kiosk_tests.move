#[test_only]
module predict_studio::note_kiosk_tests {
    use std::option;
    use predict_studio::note_kiosk;
    use sui::{
        coin,
        kiosk,
        sui::SUI,
        transfer_policy,
        tx_context,
    };

    #[test]
    fun locked_note_resale_pays_royalty() {
        let mut ctx = tx_context::dummy();
        let (mut seller_kiosk, seller_cap) = kiosk::new(&mut ctx);
        let (mut policy, policy_cap) = transfer_policy::new_for_testing<note_kiosk::StudioNote>(&mut ctx);
        note_kiosk::set_royalty(&mut policy, &policy_cap, 250, @0xB);

        let note = note_kiosk::new_note(x"010203", @0xB, 1_000_000, 123_456, 250, &mut ctx);
        let note_id = note_kiosk::id(&note);
        note_kiosk::lock_note(&mut seller_kiosk, &seller_cap, &policy, note);
        kiosk::list<note_kiosk::StudioNote>(&mut seller_kiosk, &seller_cap, note_id, 100_000);

        let payment = coin::mint_for_testing<SUI>(100_000, &mut ctx);
        let (purchased, mut request) =
            kiosk::purchase<note_kiosk::StudioNote>(&mut seller_kiosk, note_id, payment);
        let mut royalty_payment = coin::mint_for_testing<SUI>(2_500, &mut ctx);
        note_kiosk::pay_royalty(&mut policy, &mut request, &mut royalty_payment, &mut ctx);

        let (_, paid, _) = transfer_policy::confirm_request(&policy, request);
        assert!(paid == 100_000, 0);
        assert!(coin::value(&royalty_payment) == 0, 1);

        let royalty = transfer_policy::withdraw(&mut policy, &policy_cap, option::none(), &mut ctx);
        assert!(coin::value(&royalty) == 2_500, 2);

        let seller_proceeds = kiosk::close_and_withdraw(seller_kiosk, seller_cap, &mut ctx);
        assert!(coin::value(&seller_proceeds) == 100_000, 3);

        note_kiosk::destroy_note_for_testing(purchased);
        coin::burn_for_testing(royalty_payment);
        coin::burn_for_testing(royalty);
        coin::burn_for_testing(seller_proceeds);
        let empty_policy = transfer_policy::destroy_and_withdraw(policy, policy_cap, &mut ctx);
        coin::burn_for_testing(empty_policy);
    }

    #[test, expected_failure(abort_code = 8)]
    fun locked_note_cannot_be_taken_without_sale() {
        let mut ctx = tx_context::dummy();
        let (mut seller_kiosk, seller_cap) = kiosk::new(&mut ctx);
        let (mut policy, policy_cap) = transfer_policy::new_for_testing<note_kiosk::StudioNote>(&mut ctx);
        note_kiosk::set_royalty(&mut policy, &policy_cap, 250, @0xB);

        let note = note_kiosk::new_note(x"01", @0xB, 1_000_000, 123_456, 250, &mut ctx);
        let note_id = note_kiosk::id(&note);
        note_kiosk::lock_note(&mut seller_kiosk, &seller_cap, &policy, note);
        let taken = kiosk::take<note_kiosk::StudioNote>(&mut seller_kiosk, &seller_cap, note_id);

        note_kiosk::destroy_note_for_testing(taken);
        let proceeds = kiosk::close_and_withdraw(seller_kiosk, seller_cap, &mut ctx);
        coin::burn_for_testing(proceeds);
        let empty_policy = transfer_policy::destroy_and_withdraw(policy, policy_cap, &mut ctx);
        coin::burn_for_testing(empty_policy);
    }

    #[test, expected_failure(abort_code = 1)]
    fun royalty_rule_rejects_high_bps() {
        let mut ctx = tx_context::dummy();
        let (mut policy, policy_cap) = transfer_policy::new_for_testing<note_kiosk::StudioNote>(&mut ctx);
        note_kiosk::set_royalty(&mut policy, &policy_cap, 1_001, @0xB);
        let empty_policy = transfer_policy::destroy_and_withdraw(policy, policy_cap, &mut ctx);
        coin::burn_for_testing(empty_policy);
    }
}
