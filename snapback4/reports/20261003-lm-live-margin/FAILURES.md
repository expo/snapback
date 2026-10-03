# Full-suite failure classification

All 25 Rust cases below failed while opening a file-backed private store with
`Store("private store: private data directory must be a real directory")`.
Classification: **LM test-environment setup**, not a row-view assertion failure.
LM made `snapback4/target` a symlink to the required shared Cargo target. These
unchanged fixtures hardcode their scratch databases directly under that path;
`private_fs::directory` checks `symlink_metadata` and correctly refuses it.
This setup was LM's, and the original full-suite result stays red.

Source evidence: `crates/snapback4-core/src/private_fs.rs:10`,
`tests/row_view_disclosure/mod.rs:143`, and the three unit-test files under
`src/engine/row_views/` named by each panic in `full-suite.log.gz`.
These files have no LM delta. The build target must stay shared; a real local
scratch `target` with linked build subdirectories can satisfy both requirements.

| Target | Failed case | Classification |
|---|---|---|
| `snapback4-core::row_view_accounting` | `pending_and_completed_expiry_corrections_have_identical_public_meters` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_accounting` | `generated_scalar_comparisons_count_insertions_and_forward_reverse_marks` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_accounting` | `repeated_count_reads_release_transient_members` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_accounting` | `private_expiry_recount_reconciles_edits_clock_advance_and_sweep` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_accounting` | `a_new_live_basis_and_later_sweep_cannot_subtract_the_same_input_twice` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_accounting` | `count_member_decode_obeys_the_same_heap_bound_as_an_ordinary_read` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `grok_born_expired_cardinality_is_absent_from_counts_meters_and_commits` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `formerly_live_populations_and_insertion_orders_have_identical_transcripts` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `legacy_adoption_expiry_and_member_interpretations` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `interleaved_expired_prefix_live_suffix_before_mark` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `redundant_logical_witness_alternatives` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `generated_populations_transitions_and_expiry` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `value_witnesses_and_mixed_live_expiry_ranges` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_disclosure` | `public_source_blind_private_parent_refuses_without_recount_work` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_witness` | `denied_view_witness_reserves_before_hidden_presence` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_witness` | `hidden_member_payload_through_witness` | LM environment: symlink parent rejected |
| `snapback4-core::row_view_witness` | `ordinary_member_witness_control` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::certification_tests::incremental_certification_matches_naive_after_every_random_step` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::certification_tests::incremental_certification_matches_naive_with_expiring_members` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::certification_tests::lifetimes::generated_direct_lifetimes` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::certification_tests::lifetimes::generated_inherited_lifetimes` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::certification_tests::lifetimes::generated_through_lifetimes` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::tests::exact_expiring_cursor_delete_survives_private_chunk_reopen_and_sweep` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::tests::numeric_view_witness_certifies_before_comparing_a_stored_value` | LM environment: symlink parent rejected |
| `snapback4-core::snapback4_core` | `engine::row_views::tests::private_expiry_chunks_keep_durable_cursor_edits_and_restart` | LM environment: symlink parent rejected |

The four Rust targets exit 0 after the scratch-directory correction: 234
passed, 0 failed, 1 ignored (plus the library's nested one-test allocation probe).
No source or assertion change accompanies this rerun. Exact result lines from
[rust-corrected-setup.log.gz](./rust-corrected-setup.log.gz):

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 204 filtered out; finished in 0.17s
test result: ok. 204 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 124.56s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.19s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 184.15s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.09s
```

No complete-suite rerun.

## Witness CLI setup

The full client run reports 36 failures, all in `witness-acquire.test.mjs`.
Classification: **LM test-environment setup**. The preserved binary lives in
`~/sb5-lanes/lm-artifacts`, outside the client package ancestry. The CLI helper
locator (`crates/snapback4/src/verbs/witness/acquire.rs:8`) therefore cannot find
`bin/witness-acquire.js` and reports
`E_WITNESS_PROCESS: install the matching snapback4 client package to run witness acquire`.
LM failed to set the existing `SNAPBACK4_ACQUIRE_HELPER` override for that run.
Each row below has this cause; the original client-suite red is retained.

| Failed case | Classification |
|---|---|
| acquire CLI refuses invalid arguments before connecting | LM environment: relocated binary cannot find helper |
| acquire CLI saves actual SDK acquisition and cold retained receipts across fresh runs | LM environment: relocated binary cannot find helper |
| acquire refuses unknown personas, mismatched bearer identity, unreachable servers and unknown queries | LM environment: relocated binary cannot find helper |
| serve accepts a matching bearer, refuses a different principal, and omits server timings | LM environment: relocated binary cannot find helper |
| bounds guide command and receipt excerpt execute against a small fixture | LM environment: relocated binary cannot find helper |
| reconnect proof rejects more-then-drop and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects denied and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects malformed-json and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects null and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects missing-fields and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects bad-more and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects behind-server and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects dropped-first and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects drop-once and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects truncated-body and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects bad-ack and records every attempted request | LM environment: relocated binary cannot find helper |
| reconnect proof rejects bad-acquisitions and records every attempted request | LM environment: relocated binary cannot find helper |
| echoed bearer and derived refusal text never reach stderr, JSON, text or receipt files | LM environment: relocated binary cannot find helper |
| witness family usage advertises both commands and shares input diagnostics | LM environment: relocated binary cannot find helper |
| receipt identifies the JSON-line subprocess host | LM environment: relocated binary cannot find helper |
| restart times coverage separately from first answer | LM environment: relocated binary cannot find helper |
| binary native module installs and survives restart | LM environment: relocated binary cannot find helper |
| binary native module digest refusal fails proof | LM environment: relocated binary cannot find helper |
| server allowlist drops raw from every acquisition output surface | LM environment: relocated binary cannot find helper |
| server allowlist drops hex from every acquisition output surface | LM environment: relocated binary cannot find helper |
| server allowlist drops HEX from every acquisition output surface | LM environment: relocated binary cannot find helper |
| server allowlist drops base64 from every acquisition output surface | LM environment: relocated binary cannot find helper |
| server allowlist drops base64url from every acquisition output surface | LM environment: relocated binary cannot find helper |
| server allowlist drops percent from every acquisition output surface | LM environment: relocated binary cannot find helper |
| server allowlist drops percentLower from every acquisition output surface | LM environment: relocated binary cannot find helper |
| server allowlist drops sha256 from every acquisition output surface | LM environment: relocated binary cannot find helper |
| caller query and args are echoed from the request, never selected schema metadata | LM environment: relocated binary cannot find helper |
| failed query receipts distinguish argument rejection, query refusal and incomplete coverage | LM environment: relocated binary cannot find helper |
| equals token spelling authenticates without exposing the bearer | LM environment: relocated binary cannot find helper |
| acquire argument refusals omit values including equals bearers | LM environment: relocated binary cannot find helper |
| runtime refusals do not echo caller argument values in stderr | LM environment: relocated binary cannot find helper |

Focused correction uses the same pinned binary and sets `SNAPBACK4_ACQUIRE_HELPER`
to this checkout's `packages/snapback4/bin/witness-acquire.js`. The unchanged
file passes all 43 tests (0 failures), exit 0. Exact summary:

```text
ℹ tests 43
ℹ suites 0
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 90673.311188
```
