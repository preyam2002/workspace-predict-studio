module predict_studio::vault {
    use predict_studio::studio_lp::{Self as studio_lp, ShareFactory, STUDIO_LP};
    use predict_studio::studio::{Self as studio, Leg, StructuredPosition};
    use std::{
        option::{Self, Option},
        string::{Self, String},
    };
    use sui::{
        balance::{Self, Balance},
        clock::Clock,
        coin::{Self, Coin, TreasuryCap},
        event,
        object::{Self, UID},
        transfer,
        tx_context::{Self, TxContext},
    };

    const SHARE_OFFSET: u128 = 1_000_000;
    const DEAD_SHARES: u64 = 1_000;
    const PPS_SCALE: u128 = 1_000_000_000_000_000_000;

    const ENotManager: u64 = 1;
    const EBelowMinDeposit: u64 = 2;
    const EZeroShares: u64 = 3;
    const ENotReceiptOwner: u64 = 4;
    const EWrongVault: u64 = 5;
    const EWrongEpoch: u64 = 6;
    const EUnclaimedBatch: u64 = 7;
    const ENotKeeper: u64 = 8;
    const EBudgetTooHigh: u64 = 9;
    const EFeeTooHigh: u64 = 10;
    const EWrongManagerEscrow: u64 = 11;
    const EBadManagerOwner: u64 = 12;
    const EStrategyAlreadyOpen: u64 = 13;
    const EStrategyOpenWithdrawLocked: u64 = 14;

    const MAX_PUBLISHER_FEE_BPS: u64 = 10;

    public struct DUSDC_T has drop {}

    public struct StructuredVault<phantom Quote> has key, store {
        id: UID,
        manager_owner: address,
        idle: Balance<Quote>,
        pending: Balance<Quote>,
        accounted_assets: u64,
        share_treasury: TreasuryCap<STUDIO_LP>,
        total_shares: u64,
        hwm_pps_num: u128,
        min_deposit: u64,
        performance_fee_bps: u64,
        current_epoch: u64,
        claim_epoch: u64,
        claim_assets: u64,
        claim_shares: u64,
        strategy_open: bool,
        open: Option<StructuredPosition>,
        manager_cash: u64,
        strategy: String,
    }

    public struct PendingReceipt<phantom Quote> has key, store {
        id: UID,
        vault_id: ID,
        owner: address,
        epoch: u64,
        assets: u64,
    }

    public struct KeeperCap has key, store {
        id: UID,
        vault_id: ID,
        owner: address,
        max_budget: u64,
    }

    public struct ManagerEscrow has key, store {
        id: UID,
        vault_id: ID,
        manager_id: ID,
        owner: address,
    }

    public struct PublisherFeePaid has copy, drop {
        vault_id: ID,
        publisher: address,
        fee_paid: u64,
        fee_bps: u64,
        volume: u64,
    }

    public struct VaultCreated has copy, drop {
        vault_id: ID,
        manager_owner: address,
        min_deposit: u64,
        performance_fee_bps: u64,
        strategy: String,
    }

    public fun accounted_assets<Q>(v: &StructuredVault<Q>): u64 { v.accounted_assets }

    public fun pending_assets<Q>(v: &StructuredVault<Q>): u64 { balance::value(&v.pending) }

    public fun total_shares<Q>(v: &StructuredVault<Q>): u64 { v.total_shares }

    public fun current_epoch<Q>(v: &StructuredVault<Q>): u64 { v.current_epoch }

    public fun claimable_shares<Q>(v: &StructuredVault<Q>): u64 { v.claim_shares }

    public fun hwm_pps_num<Q>(v: &StructuredVault<Q>): u128 { v.hwm_pps_num }

    public fun nav<Q>(v: &StructuredVault<Q>): u64 { v.accounted_assets }

    public fun strategy_is_open<Q>(v: &StructuredVault<Q>): bool { v.strategy_open }

    public fun has_open_position<Q>(v: &StructuredVault<Q>): bool { option::is_some(&v.open) }

    public fun open_premium_paid<Q>(v: &StructuredVault<Q>): u64 {
        if (option::is_some(&v.open)) {
            studio::premium_paid(option::borrow(&v.open))
        } else {
            0
        }
    }

    public fun manager_cash<Q>(v: &StructuredVault<Q>): u64 { v.manager_cash }

    public fun escrow_vault_id(escrow: &ManagerEscrow): ID { escrow.vault_id }

    public fun escrow_manager_id(escrow: &ManagerEscrow): ID { escrow.manager_id }

    public fun escrow_owner(escrow: &ManagerEscrow): address { escrow.owner }

    fun to_shares<Q>(v: &StructuredVault<Q>, assets: u64): u64 {
        let num = (assets as u128) * ((v.total_shares as u128) + SHARE_OFFSET);
        let den = (v.accounted_assets as u128) + 1;
        (num / den) as u64
    }

    fun to_assets<Q>(v: &StructuredVault<Q>, shares: u64): u64 {
        let num = (shares as u128) * ((v.accounted_assets as u128) + 1);
        let den = (v.total_shares as u128) + SHARE_OFFSET;
        (num / den) as u64
    }

    fun pps_num<Q>(v: &StructuredVault<Q>): u128 {
        if (v.total_shares == 0) {
            0
        } else {
            ((v.accounted_assets as u128) * PPS_SCALE) / (v.total_shares as u128)
        }
    }

    fun ratchet_initial_hwm<Q>(v: &mut StructuredVault<Q>) {
        if (v.hwm_pps_num == 0 && v.total_shares > 0) {
            v.hwm_pps_num = pps_num(v);
        }
    }

    fun new_vault<Q>(
        share_treasury: TreasuryCap<STUDIO_LP>,
        manager_owner: address,
        min_deposit: u64,
        performance_fee_bps: u64,
        strategy: String,
        ctx: &mut TxContext,
    ): StructuredVault<Q> {
        StructuredVault {
            id: object::new(ctx),
            manager_owner,
            idle: balance::zero<Q>(),
            pending: balance::zero<Q>(),
            accounted_assets: 0,
            share_treasury,
            total_shares: 0,
            hwm_pps_num: 0,
            min_deposit,
            performance_fee_bps,
            current_epoch: 0,
            claim_epoch: 0,
            claim_assets: 0,
            claim_shares: 0,
            strategy_open: false,
            open: option::none(),
            manager_cash: 0,
            strategy,
        }
    }

    public fun create_vault<Q>(
        factory: ShareFactory,
        manager_owner: address,
        min_deposit: u64,
        performance_fee_bps: u64,
        strategy: String,
        ctx: &mut TxContext,
    ): StructuredVault<Q> {
        let share_treasury = studio_lp::into_treasury(factory);
        let v = new_vault<Q>(share_treasury, manager_owner, min_deposit, performance_fee_bps, strategy, ctx);
        event::emit(VaultCreated {
            vault_id: object::id(&v),
            manager_owner,
            min_deposit,
            performance_fee_bps,
            strategy: v.strategy,
        });
        v
    }

    #[allow(lint(share_owned))]
    public fun create_and_share_vault<Q>(
        factory: ShareFactory,
        manager_owner: address,
        min_deposit: u64,
        performance_fee_bps: u64,
        strategy: String,
        ctx: &mut TxContext,
    ): ID {
        let v = create_vault<Q>(factory, manager_owner, min_deposit, performance_fee_bps, strategy, ctx);
        let vault_id = object::id(&v);
        transfer::public_share_object(v);
        vault_id
    }

    #[allow(lint(share_owned))]
    public fun create_and_share_vault_with_manager_escrow<Q>(
        factory: ShareFactory,
        manager: &deepbook_predict::predict_manager::PredictManager,
        min_deposit: u64,
        performance_fee_bps: u64,
        strategy: String,
        ctx: &mut TxContext,
    ): ManagerEscrow {
        let v = create_vault<Q>(
            factory,
            manager.owner(),
            min_deposit,
            performance_fee_bps,
            strategy,
            ctx,
        );
        let escrow = create_manager_escrow(&v, manager, ctx);
        transfer::public_share_object(v);
        escrow
    }

    public fun deposit<Q>(v: &mut StructuredVault<Q>, c: Coin<Q>, ctx: &mut TxContext): Coin<STUDIO_LP> {
        let amt = coin::value(&c);
        assert!(amt >= v.min_deposit, EBelowMinDeposit);

        let mut minted = to_shares(v, amt);
        if (v.total_shares == 0) {
            assert!(minted > DEAD_SHARES, EZeroShares);
            minted = minted - DEAD_SHARES;
            v.total_shares = v.total_shares + DEAD_SHARES;
        };
        assert!(minted > 0, EZeroShares);

        balance::join(&mut v.idle, coin::into_balance(c));
        v.accounted_assets = v.accounted_assets + amt;
        v.total_shares = v.total_shares + minted;
        ratchet_initial_hwm(v);
        coin::mint(&mut v.share_treasury, minted, ctx)
    }

    public fun deposit_with_publisher<Q>(
        v: &mut StructuredVault<Q>,
        mut c: Coin<Q>,
        publisher: address,
        fee_bps: u64,
        ctx: &mut TxContext,
    ): (Coin<STUDIO_LP>, Coin<Q>, address) {
        assert!(fee_bps <= MAX_PUBLISHER_FEE_BPS, EFeeTooHigh);
        let volume = coin::value(&c);
        let fee = volume * fee_bps / 10_000;
        let fee_coin = if (fee > 0) coin::split(&mut c, fee, ctx) else coin::zero<Q>(ctx);
        if (fee > 0) {
            event::emit(PublisherFeePaid {
                vault_id: object::id(v),
                publisher,
                fee_paid: fee,
                fee_bps,
                volume,
            });
        };
        let shares = deposit(v, c, ctx);
        (shares, fee_coin, publisher)
    }

    public fun withdraw<Q>(v: &mut StructuredVault<Q>, s: Coin<STUDIO_LP>, ctx: &mut TxContext): Coin<Q> {
        assert!(!v.strategy_open && !option::is_some(&v.open), EStrategyOpenWithdrawLocked);
        let shares = coin::value(&s);
        let assets = to_assets(v, shares);
        coin::burn(&mut v.share_treasury, s);
        v.total_shares = v.total_shares - shares;
        v.accounted_assets = v.accounted_assets - assets;
        coin::take(&mut v.idle, assets, ctx)
    }

    public fun request_deposit<Q>(v: &mut StructuredVault<Q>, c: Coin<Q>, ctx: &mut TxContext): PendingReceipt<Q> {
        let assets = coin::value(&c);
        assert!(assets >= v.min_deposit, EBelowMinDeposit);
        balance::join(&mut v.pending, coin::into_balance(c));
        PendingReceipt {
            id: object::new(ctx),
            vault_id: object::id(v),
            owner: tx_context::sender(ctx),
            epoch: v.current_epoch + 1,
            assets,
        }
    }

    public fun process_pending<Q>(v: &mut StructuredVault<Q>) {
        let assets = balance::value(&v.pending);
        if (assets == 0) return;
        assert!(v.claim_assets == 0 && v.claim_shares == 0, EUnclaimedBatch);

        let mut shares = to_shares(v, assets);
        if (v.total_shares == 0) {
            assert!(shares > DEAD_SHARES, EZeroShares);
            shares = shares - DEAD_SHARES;
            v.total_shares = v.total_shares + DEAD_SHARES;
        };
        assert!(shares > 0, EZeroShares);

        let pending = balance::withdraw_all(&mut v.pending);
        balance::join(&mut v.idle, pending);
        v.accounted_assets = v.accounted_assets + assets;
        v.total_shares = v.total_shares + shares;
        v.current_epoch = v.current_epoch + 1;
        v.claim_epoch = v.current_epoch;
        v.claim_assets = assets;
        v.claim_shares = shares;
        ratchet_initial_hwm(v);
    }

    public fun claim<Q>(
        v: &mut StructuredVault<Q>,
        receipt: PendingReceipt<Q>,
        ctx: &mut TxContext,
    ): Coin<STUDIO_LP> {
        let PendingReceipt { id, vault_id, owner, epoch, assets } = receipt;
        assert!(vault_id == object::id(v), EWrongVault);
        assert!(owner == tx_context::sender(ctx), ENotReceiptOwner);
        assert!(epoch == v.claim_epoch, EWrongEpoch);
        assert!(assets <= v.claim_assets, EWrongEpoch);

        let shares = if (assets == v.claim_assets) {
            v.claim_shares
        } else {
            (((assets as u128) * (v.claim_shares as u128)) / (v.claim_assets as u128)) as u64
        };
        assert!(shares > 0, EZeroShares);
        v.claim_assets = v.claim_assets - assets;
        v.claim_shares = v.claim_shares - shares;
        object::delete(id);
        coin::mint(&mut v.share_treasury, shares, ctx)
    }

    public fun crystallize_fee<Q>(v: &mut StructuredVault<Q>, ctx: &mut TxContext): Coin<STUDIO_LP> {
        let current = pps_num(v);
        if (v.total_shares == 0 || current <= v.hwm_pps_num || v.performance_fee_bps == 0) {
            return coin::mint(&mut v.share_treasury, 0, ctx)
        };

        let gain_assets =
            ((current - v.hwm_pps_num) * (v.total_shares as u128) / PPS_SCALE) as u64;
        let fee_assets = gain_assets * v.performance_fee_bps / 10_000;
        if (fee_assets == 0 || fee_assets >= v.accounted_assets) {
            v.hwm_pps_num = current;
            return coin::mint(&mut v.share_treasury, 0, ctx)
        };

        let fee_shares =
            (((fee_assets as u128) * (v.total_shares as u128)) / ((v.accounted_assets - fee_assets) as u128)) as u64;
        v.total_shares = v.total_shares + fee_shares;
        v.hwm_pps_num = current;
        coin::mint(&mut v.share_treasury, fee_shares, ctx)
    }

    public fun grant_keeper<Q>(v: &StructuredVault<Q>, max_budget: u64, ctx: &mut TxContext): KeeperCap {
        assert!(tx_context::sender(ctx) == v.manager_owner, ENotManager);
        KeeperCap {
            id: object::new(ctx),
            vault_id: object::id(v),
            owner: tx_context::sender(ctx),
            max_budget,
        }
    }

    public fun create_manager_escrow<Q>(
        v: &StructuredVault<Q>,
        manager: &deepbook_predict::predict_manager::PredictManager,
        ctx: &mut TxContext,
    ): ManagerEscrow {
        assert!(tx_context::sender(ctx) == v.manager_owner, ENotManager);
        assert!(tx_context::sender(ctx) == manager.owner(), EBadManagerOwner);
        ManagerEscrow {
            id: object::new(ctx),
            vault_id: object::id(v),
            manager_id: object::id(manager),
            owner: tx_context::sender(ctx),
        }
    }

    public fun assert_escrowed_manager<Q>(
        v: &StructuredVault<Q>,
        escrow: &ManagerEscrow,
        manager: &deepbook_predict::predict_manager::PredictManager,
        ctx: &TxContext,
    ) {
        assert!(escrow.vault_id == object::id(v), EWrongManagerEscrow);
        assert!(escrow.manager_id == object::id(manager), EWrongManagerEscrow);
        assert!(escrow.owner == tx_context::sender(ctx), EBadManagerOwner);
        assert!(manager.owner() == escrow.owner, EBadManagerOwner);
    }

    public fun record_open_position<Q>(
        v: &mut StructuredVault<Q>,
        escrow: &ManagerEscrow,
        manager: &deepbook_predict::predict_manager::PredictManager,
        pos: StructuredPosition,
        ctx: &TxContext,
    ) {
        assert_escrowed_manager(v, escrow, manager, ctx);
        assert!(studio::owner(&pos) == escrow.owner, EBadManagerOwner);
        assert!(studio::manager_id(&pos) == escrow.manager_id, EWrongManagerEscrow);
        assert!(!option::is_some(&v.open), EStrategyAlreadyOpen);
        option::fill(&mut v.open, pos);
        v.strategy_open = true;
    }

    public fun fund_manager_from_idle<Q>(
        v: &mut StructuredVault<Q>,
        escrow: &ManagerEscrow,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert_escrowed_manager(v, escrow, manager, ctx);
        let c = coin::take(&mut v.idle, amount, ctx);
        manager.deposit<Q>(c, ctx);
        v.manager_cash = v.manager_cash + amount;
    }

    public fun roll_into_strategy<Q>(
        v: &mut StructuredVault<Q>,
        escrow: &ManagerEscrow,
        predict: &mut deepbook_predict::predict::Predict,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        oracle: &deepbook_predict::oracle::OracleSVI,
        shape: String,
        legs: vector<Leg>,
        max_loss_budget: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_escrowed_manager(v, escrow, manager, ctx);
        let balance_before = manager.balance<Q>();
        let pos = studio::build_and_mint<Q>(
            predict,
            manager,
            oracle,
            shape,
            legs,
            max_loss_budget,
            clock,
            ctx,
        );
        let spent = balance_before - manager.balance<Q>();
        if (spent >= v.manager_cash) {
            v.manager_cash = 0;
        } else {
            v.manager_cash = v.manager_cash - spent;
        };
        record_open_position(v, escrow, manager, pos, ctx);
    }

    public fun keeper_roll<Q>(v: &mut StructuredVault<Q>, cap: &KeeperCap, budget: u64) {
        assert!(cap.vault_id == object::id(v), ENotKeeper);
        assert!(budget <= cap.max_budget, EBudgetTooHigh);
        v.strategy_open = false;
        process_pending(v);
    }

    #[test_only]
    public fun new_factory_for_testing(ctx: &mut TxContext): ShareFactory {
        studio_lp::new_factory_for_testing(ctx)
    }

    #[test_only]
    public fun new_for_testing(ctx: &mut TxContext): StructuredVault<DUSDC_T> {
        let factory = new_factory_for_testing(ctx);
        create_vault<DUSDC_T>(factory, tx_context::sender(ctx), 1, 1_000, string::utf8(b"test"), ctx)
    }

    #[test_only]
    public fun donate_for_testing<Q>(v: &mut StructuredVault<Q>, c: Coin<Q>) {
        balance::join(&mut v.idle, coin::into_balance(c));
    }

    #[test_only]
    public fun set_accounted_assets_for_testing<Q>(v: &mut StructuredVault<Q>, assets: u64) {
        v.accounted_assets = assets;
    }

    #[test_only]
    public fun set_strategy_open_for_testing<Q>(v: &mut StructuredVault<Q>, open: bool) {
        v.strategy_open = open;
    }

    #[test_only]
    public fun destroy_keeper_for_testing(cap: KeeperCap) {
        let KeeperCap { id, vault_id: _, owner: _, max_budget: _ } = cap;
        object::delete(id);
    }

    #[test_only]
    public fun destroy_manager_escrow_for_testing(escrow: ManagerEscrow) {
        let ManagerEscrow { id, vault_id: _, manager_id: _, owner: _ } = escrow;
        object::delete(id);
    }

    #[test_only]
    public fun destroy_for_testing<Q>(v: StructuredVault<Q>) {
        let StructuredVault {
            id,
            manager_owner: _,
            idle,
            pending,
            accounted_assets: _,
            share_treasury,
            total_shares: _,
            hwm_pps_num: _,
            min_deposit: _,
            performance_fee_bps: _,
            current_epoch: _,
            claim_epoch: _,
            claim_assets: _,
            claim_shares: _,
            strategy_open: _,
            open,
            manager_cash: _,
            strategy: _,
        } = v;
        balance::destroy_for_testing(idle);
        balance::destroy_for_testing(pending);
        if (option::is_some(&open)) {
            studio::destroy_for_testing(option::destroy_some(open));
        } else {
            option::destroy_none(open);
        };
        std::unit_test::destroy(share_treasury);
        object::delete(id);
    }
}
