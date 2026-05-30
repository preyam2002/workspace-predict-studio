#[test_only]
module predict_studio::studio_tests {
    use std::string;
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

    #[test]
    fun publisher_fee_is_capped_and_rounded_down() {
        assert!(studio::publisher_fee(1_000_000, 10) == 1_000, 0);
        assert!(studio::publisher_fee(999, 10) == 0, 1);
    }

    #[test, expected_failure(abort_code = 6)]
    fun publisher_fee_rejects_above_cap() {
        studio::publisher_fee(1_000_000, 11);
    }

    #[test]
    fun structure_hash_matches_ts_fixture() {
        let shape = string::utf8(b"digital_call");
        let legs = vector[
            studio::new_leg(false, true, 100, 0, 1_000_000),
        ];
        assert!(
            studio::structure_hash(&shape, &legs)
                == x"7cd4ab55e5298923d572ad683d10cabd8488fd368f692b62bed9739f1fca20ac",
            0,
        );
    }
}
