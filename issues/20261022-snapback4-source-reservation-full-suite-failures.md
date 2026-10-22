# Snapback 4 full-suite failures: source-reservation derivation

Status: Open
Owner: core / release integration (outside SEC8)
Observed: 2026-10-22, SEC8 worktree based on cadb7c55be

The full workspace run reaches four source-reservation failures in unchanged
residency/timeline code:

- `init::w7a_residency_measures_the_wired_500_follow_reader`
- `init::w8b_residency_measures_the_wired_calibration_shape`
- `timeline_adoption::retirement_resets_dependent_aggregates_even_when_all_names_survive`
- `timeline_adoption::check_and_adoption_agree_across_expiry_through_changes_and_following_presence`

Each refuses `E_SCHEMA: source reservations differ from the schema derivation`
from `crates/snapback4-core/src/engine/activation_facts.rs:35`. The timeline tests
manually change compiled schema metadata; the residency tests load the wired
Following recipe. SEC8 does not change core schema/activation or recipe/residency
logic. Inheritance is inferred from that unchanged scope, not claimed from a
separate baseline execution. Preserve the validation law; do not clear metadata
blindly to silence these tests.

Reproduce from snapback4/ with a timeout and the required same-command environment:

```
timeout 600s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --test init w7a_residency_measures_the_wired_500_follow_reader -- --exact
timeout 600s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --test timeline_adoption retirement_resets_dependent_aggregates_even_when_all_names_survive -- --exact
```

Final SEC8 evidence is in snapback4/reports/20261022-sec8 and WORKSTREAM-REPORT.md.
This ticket is a scoped follow-up, not a claim that the affected proofs passed.
