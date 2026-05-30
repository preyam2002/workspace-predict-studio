#[test_only]
module predict_studio::pt_yt_tests {
    use predict_studio::{pt_yt, vault};
    use sui::{coin, tx_context};

    fun minted_share(ctx: &mut tx_context::TxContext): (vault::StructuredVault<vault::DUSDC_T>, coin::Coin<vault::STUDIO_LP>) {
        let mut v = vault::new_for_testing(ctx);
        let shares = vault::deposit(
            &mut v,
            coin::mint_for_testing<vault::DUSDC_T>(1_000_000, ctx),
            ctx,
        );
        (v, shares)
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
}
