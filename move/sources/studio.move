/// Predict Studio — defined-risk structured-payoff engine on DeepBook Predict.
///
/// A `StructuredPosition` wraps an N-leg basket of DeepBook Predict binary/range
/// positions (which live as quantity rows inside a shared `PredictManager`) into a
/// single owned object with a chain-enforced worst-case-loss envelope.
///
/// Day-1 skeleton: object + events compile standalone. `build_and_mint` / `settle`
/// are wired to `deepbook_predict` in the next step (after the gas benchmark confirms
/// the per-PTB leg budget against the 5M computation-unit cap).
module predict_studio::studio {
    use std::string::String;

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

    // --- Read-only getters (used by the TS engine / verifiable-analytics layer) ---

    public fun max_loss(self: &StructuredPosition): u64 { self.max_loss }
    public fun max_gain(self: &StructuredPosition): u64 { self.max_gain }
    public fun premium_paid(self: &StructuredPosition): u64 { self.premium_paid }
    public fun leg_count(self: &StructuredPosition): u64 { self.legs.length() }
    public fun is_settled(self: &StructuredPosition): bool { self.settled }
    public fun shape(self: &StructuredPosition): &String { &self.shape }

    public fun new_leg(
        is_range: bool, is_up: bool, lower_strike: u64, higher_strike: u64, quantity: u64,
    ): Leg {
        Leg { is_range, is_up, lower_strike, higher_strike, quantity }
    }
}
