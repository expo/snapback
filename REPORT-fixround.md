# Fix-round report

## Finding 1 — client reference-kind gate

`assertClientReferenceKind` now preserves the compatibility path only for a
string reference. Every other value is classified as a known reference kind or
as the payload-safe sentinel `missing`, `unknown`, or `malformed`; an invalid
kind raises `SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH` before reference-name
validation and before transport.

Known wrong kinds retain the exact replacement verb. When no correct verb can
be known, the diagnostic exposes no received payload and instead sets
`correctVerb: null` with the repair to regenerate references and align the
client/codegen package versions.

The regression matrix sends missing-kind, future-kind, and malformed-kind
objects with deliberately invalid/missing names through all five
transport-capable verbs (`query`, `liveQuery`, `mutate`, `action`, and
`commandClient.start`). It asserts the mismatch code, payload-safe diagnostic,
skew repair, and a final transport count of zero: 15 invalid-kind/verb cases in
one test, alongside the existing complete known-kind mismatch matrix.

## Finding 2 — closed media proof binding

`StagedMediaProjectionProofV1` now owns a closed
`MediaProjectionProofBindingV1` containing:

- process epoch and nonzero invocation nonce;
- principal digest and authority-instance binding;
- function id and artifact generation;
- result-contract hash and pinned snapshot;
- server request/invocation identity and client-mutation identity digest.

The proof is no longer `Clone` and owns its occurrences directly. Runtime
handoff carries a separate invocation scope; `local.rs` reconstructs the
expected binding from that scope plus the still-trusted prepared invocation and
request input. Storage receives the proof and expected record separately and
compares them before OCC admission or egress materialization.

The storage access type distinguishes a borrowed preview from an owned commit.
Dry-run passes references to the exact proof and expected binding, while the
authoritative commit takes and consumes the only proof owner. Cancellation or
failure drops that owner; a retry must execute again and use a fresh invocation
nonce. Existing-settlement recovery remains before proof admission so a
concurrent same-id loser expires its proof and returns the winner's sealed
bytes without dispatch or egress.

Tests mutate every binding member independently (including the review's
cross-request, cross-principal, cross-function, and cross-generation cases),
exercise an actual preview followed by commit of the same proof owner, and
cover cancellation, fresh-nonce retry, and same-id-winner recovery.

## Finding 3 — settlement retained-byte accounting

Counter formula version 4 defines one logical retained-row byte measure for:

- `client_mutation_id`;
- `function`;
- `auth_fingerprint`;
- optional `authority_instance_id`;
- `input_fingerprint`;
- optional `operation_issuance_json`;
- `output_json`;
- `settlement_format`;
- one exact logical eight-byte `settlement_record_sequence`; and
- optional `settlement_projection_seal_json`.

The same Rust helper is used for insertion admission, global reconstruction,
per-authority reconstruction, and individual acknowledgement. Authority-wide
and per-authority collection scan with that helper and refuse stale counters
before subtracting the corresponding exact global/per-authority totals.

The explicit migration rule is the counter-version bump from 3 to 4: opening a
store with any predecessor version (or missing/malformed global counters)
rebuilds global and per-authority counters from the already format-epoch-stamped
rows before another settlement is admitted.

The mixed-row test creates a real predecessor row, reopens through the legacy
format migration and V4 rebuild, inserts plain and media-projected rows, forces
another rebuild, acknowledges the two new rows, and proves both global and
per-authority counters return byte-for-byte to their predecessor values. A
final reopen/rebuild proves that exact predecessor again.

## Verification

Native runtime bootstrap completed its exact link, launch, and restricted
handler-VM qualification before Cargo tests.

Node reference-kind suite:

```text
$ env -u FORCE_COLOR node --test packages/snapback-client/reference-kind.test.mjs
✔ every wrong generated reference/verb pair refuses before transport (7.269083ms)
✔ missing, future, and malformed object kinds refuse every verb before transport (0.893709ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 102.536041
```

Runtime media-provenance module:

```text
$ cargo test --lib media_provenance_tests -- --nocapture
running 2 tests
test runtime::media_provenance_tests::preview_borrows_and_commit_takes_the_only_proof_owner ... ok
test runtime::media_provenance_tests::exact_token_overwrites_handler_kind_while_copy_and_cross_source_refuse ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 2644 filtered out; finished in 0.00s
```

Storage media-acceptance module:

```text
$ cargo test --lib media_ref_projection_acceptance_tests -- --nocapture
running 10 tests
test storage::tests::media_ref_projection_acceptance_tests::closed_proof_binding_refuses_every_scope_authority_function_and_request_swap ... ok
test storage::tests::media_ref_projection_acceptance_tests::dry_run_borrows_exact_proof_then_authoritative_commit_takes_its_owner ... ok
test storage::tests::media_ref_projection_acceptance_tests::related_media_fact_movement_refuses_at_the_ordinary_occ_gate ... ok
test storage::tests::media_ref_projection_acceptance_tests::projected_kind_objects_are_refused_as_forged_write_authority ... ok
test storage::tests::media_ref_projection_acceptance_tests::cancelled_attempt_expires_proof_fresh_retry_mints_new_nonce_and_same_id_winner_replays ... ok
test storage::tests::media_ref_projection_acceptance_tests::pending_media_attachment_is_refused_at_the_commit_boundary ... ok
test storage::tests::media_ref_projection_acceptance_tests::settlement_epoch_watermarks_predecessors_and_never_reopens_legacy_admission ... ok
test storage::tests::media_ref_projection_acceptance_tests::valid_json_semantic_edit_of_media_settlement_fails_before_recovery_publication ... ok
test storage::tests::media_ref_projection_acceptance_tests::query_projection_is_snapshot_local_retry_is_exact_and_denied_delivery_is_not_an_oracle ... ok
test storage::tests::media_ref_projection_acceptance_tests::mixed_settlement_rows_ack_and_rebuild_to_exact_predecessor_counters ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 2636 filtered out; finished in 0.15s
```

Settlement-filtered library suite:

```text
$ cargo test --lib settlement -- --nocapture
running 17 tests
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 2629 filtered out; finished in 0.68s
```

Supplemental retention/accounting filter:

```text
$ cargo test --lib retention -- --nocapture
running 19 tests
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 2627 filtered out; finished in 0.46s
```

Reference validation:

```text
$ ./ref-check --verbose
ref-check: ok — 245 LLP docs, 5959 refs in 13551 files, 0 errors, 0 unchecked
```

`git diff --check` is silent with exit status 0.

## Deviations and unrelated blockers

- No implementation deviation from the three requested fix shapes.
- The required Cargo module runs use `--lib`. An initial unscoped
  `cargo test media_provenance_tests -- --nocapture` also tried to compile every
  integration-test target and stopped on pre-existing, out-of-charter
  `TableManifest` initializers missing the candidate tree's new
  `authority_profile` field in `tests/mutation_settlement_identity_v0.rs`,
  `tests/membership_authoring_v0.rs`, `tests/structural_validation_v0.rs`, and
  `tests/network_profile_v1.rs`. None of those files is modified here.
- A diagnostic `cargo fmt --all -- --check` reports broad repository-wide
  drift, including many unrelated tracked files, under the current rustfmt.
  It was not applied because that would rewrite unrelated files; the requested
  changes pass `git diff --check` and all scoped tests.
- The full rotation was not run, as directed by `FIXROUND-CHARTER.md`.
- Accepted LLP text was not changed. Existing unrelated untracked files were
  left intact. No commit was created.
