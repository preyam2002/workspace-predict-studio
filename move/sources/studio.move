/// Predict Studio — defined-risk structured-payoff engine on DeepBook Predict.
///
/// A `StructuredPosition` wraps an N-leg basket of DeepBook Predict binary/range
/// positions (which live as quantity rows inside a shared `PredictManager`) into a
/// single owned object with a chain-enforced worst-case-loss envelope.
///
module predict_studio::studio {
    use std::bcs;
    use std::string::String;
    use sui::{
        clock::Clock,
        event,
        hash,
        object::{Self, UID},
        transfer,
        tx_context::{Self, TxContext},
    };

    const EMaxLossExceeded: u64 = 1;
    const ETooManyLegs: u64 = 2;
    const ENotOwner: u64 = 3;
    const EAlreadySettled: u64 = 4;
    const EOracleNotSettled: u64 = 5;
    const EFeeTooHigh: u64 = 6;

    const MAX_PUBLISHER_FEE_BPS: u64 = 10;

    /// One leg of a structured payoff: a Predict binary or range position.
    /// `is_range` selects binary vs vertical range; strikes/direction are recorded
    /// for the on-chain payoff/max-loss computation performed at mint time.
    public struct Leg has copy, drop, store {
        is_range: bool,
        is_up: bool,        // binary direction (ignored for ranges)
        lower_strike: u64,  // binary: the strike; range: lower bound
        higher_strike: u64, // range only: upper bound
        quantity: u64,
    }

    /// A minted structured payoff, owned by the trader.
    public struct StructuredPosition has key, store {
        id: UID,
        owner: address,
        manager_id: ID,     // the PredictManager holding the underlying legs
        oracle_id: ID,
        expiry_ms: u64,
        shape: String,      // e.g. "bull_spread", "iron_condor", "collar"
        legs: vector<Leg>,
        premium_paid: u64,  // total cost across legs (quote units)
        max_loss: u64,      // chain-enforced worst-case loss
        max_gain: u64,      // best-case payout
        settled: bool,
    }

    // --- Events (indexer surface for the UI / backtester) ---

    public struct StructureMinted has copy, drop {
        position_id: ID,
        owner: address,
        shape: String,
        leg_count: u64,
        premium_paid: u64,
        max_loss: u64,
        max_gain: u64,
    }

    public struct StructureSettled has copy, drop {
        position_id: ID,
        owner: address,
        payout: u64,
        pnl_is_gain: bool,
        pnl_abs: u64,
    }

    public struct PublisherFeePaid has copy, drop {
        position_id: ID,
        publisher: address,
        fee_paid: u64,
        fee_bps: u64,
    }

    // --- Read-only getters (used by the TS engine / verifiable-analytics layer) ---

    public fun max_loss(self: &StructuredPosition): u64 { self.max_loss }
    public fun max_gain(self: &StructuredPosition): u64 { self.max_gain }
    public fun premium_paid(self: &StructuredPosition): u64 { self.premium_paid }
    public fun owner(self: &StructuredPosition): address { self.owner }
    public fun manager_id(self: &StructuredPosition): ID { self.manager_id }
    public fun oracle_id(self: &StructuredPosition): ID { self.oracle_id }
    public fun leg_count(self: &StructuredPosition): u64 { self.legs.length() }
    public fun is_settled(self: &StructuredPosition): bool { self.settled }
    public fun shape(self: &StructuredPosition): &String { &self.shape }

    public fun new_leg(
        is_range: bool, is_up: bool, lower_strike: u64, higher_strike: u64, quantity: u64,
    ): Leg {
        Leg { is_range, is_up, lower_strike, higher_strike, quantity }
    }

    public fun structure_hash(shape: &String, legs: &vector<Leg>): vector<u8> {
        let mut bytes = bcs::to_bytes(shape);
        bytes.append(bcs::to_bytes(legs));
        hash::blake2b256(&bytes)
    }

    public fun publisher_fee(premium_paid: u64, fee_bps: u64): u64 {
        assert!(fee_bps <= MAX_PUBLISHER_FEE_BPS, EFeeTooHigh);
        premium_paid * fee_bps / 10_000
    }

    public fun marked_value(
        predict: &deepbook_predict::predict::Predict,
        oracle: &deepbook_predict::oracle::OracleSVI,
        pos: &StructuredPosition,
        clock: &Clock,
    ): u64 {
        use deepbook_predict::market_key;
        use deepbook_predict::predict;
        use deepbook_predict::range_key;

        let mut total = 0;
        let mut i = 0;
        while (i < pos.legs.length()) {
            let leg = &pos.legs[i];
            let bid = if (leg.is_range) {
                let key = range_key::new(pos.oracle_id, pos.expiry_ms, leg.lower_strike, leg.higher_strike);
                let (_, bid) = predict::get_range_trade_amounts(predict, oracle, key, leg.quantity, clock);
                bid
            } else {
                let key = market_key::new(pos.oracle_id, pos.expiry_ms, leg.lower_strike, leg.is_up);
                let (_, bid) = predict::get_trade_amounts(predict, oracle, key, leg.quantity, clock);
                bid
            };
            total = total + bid;
            i = i + 1;
        };
        total
    }

    /// Atomically mint every leg of a structure, enforce the worst-case-loss
    /// budget, and return one owned StructuredPosition.
    public fun build_and_mint<Quote>(
        predict: &mut deepbook_predict::predict::Predict,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        oracle: &deepbook_predict::oracle::OracleSVI,
        shape: String,
        legs: vector<Leg>,
        max_loss_budget: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): StructuredPosition {
        use deepbook_predict::market_key;
        use deepbook_predict::predict;
        use deepbook_predict::range_key;

        assert!(tx_context::sender(ctx) == manager.owner(), ENotOwner);
        assert!(!legs.is_empty() && legs.length() <= 24, ETooManyLegs);

        let oracle_id = oracle.id();
        let expiry = oracle.expiry();
        let balance_before = manager.balance<Quote>();

        let mut i = 0;
        while (i < legs.length()) {
            let leg = &legs[i];
            if (leg.is_range) {
                let key = range_key::new(oracle_id, expiry, leg.lower_strike, leg.higher_strike);
                predict::mint_range<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
            } else {
                let key = market_key::new(oracle_id, expiry, leg.lower_strike, leg.is_up);
                predict::mint<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
            };
            i = i + 1;
        };

        let balance_after = manager.balance<Quote>();
        let premium_paid = balance_before - balance_after;
        assert!(premium_paid <= max_loss_budget, EMaxLossExceeded);

        let max_gain = max_payout(&legs);
        let pos = StructuredPosition {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            manager_id: object::id(manager),
            oracle_id,
            expiry_ms: expiry,
            shape,
            legs,
            premium_paid,
            max_loss: premium_paid,
            max_gain,
            settled: false,
        };

        event::emit(StructureMinted {
            position_id: object::id(&pos),
            owner: pos.owner,
            shape: pos.shape,
            leg_count: pos.legs.length(),
            premium_paid,
            max_loss: premium_paid,
            max_gain,
        });

        pos
    }

    #[allow(lint(self_transfer))]
    public fun build_and_mint_to_sender<Quote>(
        predict: &mut deepbook_predict::predict::Predict,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        oracle: &deepbook_predict::oracle::OracleSVI,
        shape: String,
        legs: vector<Leg>,
        max_loss_budget: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let pos = build_and_mint<Quote>(
            predict,
            manager,
            oracle,
            shape,
            legs,
            max_loss_budget,
            clock,
            ctx,
        );
        transfer::public_transfer(pos, tx_context::sender(ctx));
    }

    public fun build_and_mint_with_publisher<Quote>(
        predict: &mut deepbook_predict::predict::Predict,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        oracle: &deepbook_predict::oracle::OracleSVI,
        shape: String,
        legs: vector<Leg>,
        max_loss_budget: u64,
        publisher: address,
        fee_bps: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): StructuredPosition {
        let mut pos = build_and_mint<Quote>(
            predict,
            manager,
            oracle,
            shape,
            legs,
            max_loss_budget,
            clock,
            ctx,
        );
        let fee = publisher_fee(pos.premium_paid, fee_bps);
        if (fee > 0) {
            assert!(pos.premium_paid + fee <= max_loss_budget, EMaxLossExceeded);
            let fee_coin = manager.withdraw<Quote>(fee, ctx);
            transfer::public_transfer(fee_coin, publisher);
            pos.max_loss = pos.premium_paid + fee;
            event::emit(PublisherFeePaid {
                position_id: object::id(&pos),
                publisher,
                fee_paid: fee,
                fee_bps,
            });
        };
        pos
    }

    public fun settle<Quote>(
        predict: &mut deepbook_predict::predict::Predict,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        oracle: &deepbook_predict::oracle::OracleSVI,
        pos: &mut StructuredPosition,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        use deepbook_predict::market_key;
        use deepbook_predict::predict;
        use deepbook_predict::range_key;

        assert!(tx_context::sender(ctx) == pos.owner, ENotOwner);
        assert!(tx_context::sender(ctx) == manager.owner(), ENotOwner);
        assert!(!pos.settled, EAlreadySettled);
        assert!(oracle.is_settled(), EOracleNotSettled);

        let before = manager.balance<Quote>();
        let mut i = 0;
        while (i < pos.legs.length()) {
            let leg = &pos.legs[i];
            if (leg.is_range) {
                let key = range_key::new(pos.oracle_id, pos.expiry_ms, leg.lower_strike, leg.higher_strike);
                predict::redeem_range<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
            } else {
                let key = market_key::new(pos.oracle_id, pos.expiry_ms, leg.lower_strike, leg.is_up);
                predict::redeem_permissionless<Quote>(
                    predict,
                    manager,
                    oracle,
                    key,
                    leg.quantity,
                    clock,
                    ctx,
                );
            };
            i = i + 1;
        };

        let payout = manager.balance<Quote>() - before;
        pos.settled = true;
        let (pnl_is_gain, pnl_abs) = if (payout >= pos.premium_paid) {
            (true, payout - pos.premium_paid)
        } else {
            (false, pos.premium_paid - payout)
        };

        event::emit(StructureSettled {
            position_id: object::id(pos),
            owner: pos.owner,
            payout,
            pnl_is_gain,
            pnl_abs,
        });
    }

    public fun settle_to_receipt<Quote>(
        predict: &mut deepbook_predict::predict::Predict,
        manager: &mut deepbook_predict::predict_manager::PredictManager,
        oracle: &deepbook_predict::oracle::OracleSVI,
        pos: &mut StructuredPosition,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        settle<Quote>(predict, manager, oracle, pos, clock, ctx);
    }

    public fun max_payout(legs: &vector<Leg>): u64 {
        let mut best = 0;
        let mut i = 0;
        while (i < legs.length()) {
            let leg = &legs[i];
            best = max_u64(best, payout_at(legs, leg.lower_strike));
            if (leg.lower_strike > 0) {
                best = max_u64(best, payout_at(legs, leg.lower_strike - 1));
            };
            best = max_u64(best, payout_at(legs, leg.lower_strike + 1));

            if (leg.is_range) {
                best = max_u64(best, payout_at(legs, leg.higher_strike));
                if (leg.higher_strike > 0) {
                    best = max_u64(best, payout_at(legs, leg.higher_strike - 1));
                };
                best = max_u64(best, payout_at(legs, leg.higher_strike + 1));
            };
            i = i + 1;
        };
        best
    }

    public fun payout_at_settlement(legs: &vector<Leg>, settlement: u64): u64 {
        payout_at(legs, settlement)
    }

    fun payout_at(legs: &vector<Leg>, settlement: u64): u64 {
        let mut payout = 0;
        let mut i = 0;
        while (i < legs.length()) {
            let leg = &legs[i];
            if (leg_pays(leg, settlement)) {
                payout = payout + leg.quantity;
            };
            i = i + 1;
        };
        payout
    }

    fun leg_pays(leg: &Leg, settlement: u64): bool {
        if (leg.is_range) {
            settlement > leg.lower_strike && settlement <= leg.higher_strike
        } else if (leg.is_up) {
            settlement > leg.lower_strike
        } else {
            settlement < leg.lower_strike
        }
    }

    fun max_u64(a: u64, b: u64): u64 {
        if (a > b) a else b
    }

    public(package) fun destroy_settled(pos: StructuredPosition) {
        assert!(pos.settled, EOracleNotSettled);
        let StructuredPosition {
            id,
            owner: _,
            manager_id: _,
            oracle_id: _,
            expiry_ms: _,
            shape: _,
            legs: _,
            premium_paid: _,
            max_loss: _,
            max_gain: _,
            settled: _,
        } = pos;
        object::delete(id);
    }

    #[test_only]
    public fun new_for_testing(
        manager_id: ID,
        oracle_id: ID,
        shape: String,
        legs: vector<Leg>,
        premium_paid: u64,
        ctx: &mut TxContext,
    ): StructuredPosition {
        let max_gain = max_payout(&legs);
        StructuredPosition {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            manager_id,
            oracle_id,
            expiry_ms: 0,
            shape,
            legs,
            premium_paid,
            max_loss: premium_paid,
            max_gain,
            settled: false,
        }
    }

    #[test_only]
    public fun destroy_for_testing(pos: StructuredPosition) {
        let StructuredPosition {
            id,
            owner: _,
            manager_id: _,
            oracle_id: _,
            expiry_ms: _,
            shape: _,
            legs: _,
            premium_paid: _,
            max_loss: _,
            max_gain: _,
            settled: _,
        } = pos;
        object::delete(id);
    }
}
