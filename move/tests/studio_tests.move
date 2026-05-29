#[test_only]
module predict_studio::studio_tests {
    use predict_studio::studio;

    #[test]
    fun max_payout_handles_range_and_tail() {
        let legs = vector[
            studio::new_leg(false, true, 70_000, 0, 1_000_000),
            studio::new_leg(true, false, 68_000, 70_000, 1_000_000),
        ];

        assert!(studio::max_payout(&legs) == 1_000_000, 0);
    }

    #[test]
    fun max_payout_handles_downside_only() {
        let legs = vector[
            studio::new_leg(false, false, 70_000, 0, 1_000_000),
        ];

        assert!(studio::max_payout(&legs) == 1_000_000, 0);
    }
}
