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

Additional unchanged fixtures found by the commissioned full run:

- Device `readauth::outcomes`: `recipe_post_{memory,sqlite}`,
  `recipe_repost_{memory,sqlite}`, `bridge_publish_{memory,sqlite}` and
  `bridge_repost_{memory,sqlite}` (eight tests), the same reservation refusal at
  `tests/readauth/outcomes.rs:149` or `:225`.
- Language `live_parent`: `adoption_reserves_destination_index_sets_before_live_callback`,
  `bulk_restore_reserves_all_index_vectors_before_put`,
  `reverse_manual_adoption_reserves_destination_index_sets`,
  `seed_prepays_source_index_vectors_before_ordinary_upsert`,
  `cap_restore_selects_a_plain_index_instead_of_word_entries`, and
  `live_to_captured_adoption_prepays_word_index_fanout` (six tests). These fail the
  reservation validator, including fixtures expecting E_BOUND but getting E_SCHEMA.
- Language `declarative_receipts`:
  `allocation::dependencies::derived_prediction::round1::authentic_predecessor_stores_open_install_and_converge`
  fails `Schema("add: execution facts changed without a program change")` at
  `tests/declarative_receipts/prediction_round1.rs:255` (distinct execution-facts
  validator, same inherited metadata/fixture area).

SEC8 also found and repaired two introduced expectation problems: the public
security-review test now expects a comment-only edit to preserve its decision,
and the guide census now includes definition/recovery pins for all new notes.
Their dedicated reruns pass; they are not part of this open core follow-up.

The fresh Linux packed consumer qualification also stops in `proveDay5` on the
installed testing-guide recipe:
`test --residency --fixture-only --fixture fixtures --as alice` refuses the same
source-reservation E_SCHEMA. Earlier day2/DX4/DX5/DX6, Expo upgrade/export, day4,
release-transition and dormant proofs pass. No qualification receipt exists.
See `snapback4/reports/20261022-sec8/linux-r6-incomplete/` for safe partial proof
records and the failed command log. This is an affected existing product check
requiring core/release integration repair; SEC8 does not bypass it.

The completed workspace run also finds two unchanged simulator fixtures:
`maintains_recorded::equivalence_after_deletion_reuse_and_unswept_expiry` and
`maintains_recorded::activation_dangling_expired_reused_and_removed_paths`.
Both refuse the same source-reservation E_SCHEMA at
`crates/snapback4-sim/tests/maintains_recorded.rs:30`.
There are21 unchanged metadata-fixture failures in the complete workspace run;
six additional initial-run SEC8 expectation failures are repaired and pass the
final workspace-feature affected rerun (228 tests). The full final security/guide
set also passes374 tests (two ignored). The complete raw log remains red and is
retained; no full-suite pass is claimed.
