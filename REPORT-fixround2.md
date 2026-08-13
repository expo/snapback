# Fix-round 2 report

## Finding 1 — proof binding closure

Media proof binding now refuses an absent or malformed function artifact
generation. `MediaProjectionProofBindingV1.function_artifact_generation` is a
concrete `String`, runtime proof creation accepts only a `sha256:` generation
with 64 hexadecimal digits, storage rechecks that fact at admission, and
manifest validation loudly refuses a media-bearing result contract without an
`implementationHash`.

The proof's commit identity is now the closed enum
`MediaProjectionClientMutationIdentityV1::{ClientMutation(digest),
NoClientIdentity}`; it is never optional. Action-hosted child mutation staging
receives the separately minted storage identity before handler execution,
projects its digest into the proof input, carries it through detached preview,
and reconstructs the expected binding from the actual commit identity. The
authoritative storage boundary independently compares the proof with the exact
`ClientMutationIdentity` argument before OCC admission.

Adversarial coverage now proves that equal absent generations refuse, that
`NoClientIdentity` cannot collapse with a concrete storage identity in either
direction, and that an action-hosted child proof minted for one separately
carried identity refuses when commit supplies another.

## Finding 2 — outbox replay compatibility

Production replay and stranded re-record reconstruction now create generated
mutation references as `{ kind: "Mutation", name, expectedGeneration }`.
String-reference compatibility remains unchanged, and the strict external kind
gate was not weakened.

`GeneratedMutationReplayClientDouble` was removed. The replay and sidecar tests
now use `SnapbackClient` directly. The review-shaped offline queue → production
replay probe asserts `replayed: 1`, `failed: 0`, `remaining: 0`, one settled
record, and the exact queued generation. A separate regression manually stores
the older kindless durable shape and proves that its own mutation facts derive
the nominal kind during replay instead of terminally retiring it. Stranded
re-record coverage likewise exercises the production reconstruction with a
generation-bound mutation.

## Verification

Native runtime bootstrap completed its exact link, launch, and restricted
handler-VM qualification before the Rust tests.

Runtime media-provenance module:

```text
$ cargo test --lib media_provenance_tests -- --nocapture
running 2 tests
test runtime::media_provenance_tests::preview_borrows_and_commit_takes_the_only_proof_owner ... ok
test runtime::media_provenance_tests::exact_token_overwrites_handler_kind_while_copy_and_cross_source_refuse ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 2646 filtered out; finished in 0.00s
```

Storage media-acceptance module (includes the None-collapse regression):

```text
$ cargo test --lib media_ref_projection_acceptance_tests -- --nocapture
running 11 tests
test storage::tests::media_ref_projection_acceptance_tests::closed_proof_binding_refuses_every_scope_authority_function_and_request_swap ... ok
test storage::tests::media_ref_projection_acceptance_tests::previous_none_collapses_refuse_missing_generation_and_concrete_commit_identity ... ok
test storage::tests::media_ref_projection_acceptance_tests::related_media_fact_movement_refuses_at_the_ordinary_occ_gate ... ok
test storage::tests::media_ref_projection_acceptance_tests::query_projection_is_snapshot_local_retry_is_exact_and_denied_delivery_is_not_an_oracle ... ok
test storage::tests::media_ref_projection_acceptance_tests::pending_media_attachment_is_refused_at_the_commit_boundary ... ok
test storage::tests::media_ref_projection_acceptance_tests::cancelled_attempt_expires_proof_fresh_retry_mints_new_nonce_and_same_id_winner_replays ... ok
test storage::tests::media_ref_projection_acceptance_tests::valid_json_semantic_edit_of_media_settlement_fails_before_recovery_publication ... ok
test storage::tests::media_ref_projection_acceptance_tests::projected_kind_objects_are_refused_as_forged_write_authority ... ok
test storage::tests::media_ref_projection_acceptance_tests::settlement_epoch_watermarks_predecessors_and_never_reopens_legacy_admission ... ok
test storage::tests::media_ref_projection_acceptance_tests::mixed_settlement_rows_ack_and_rebuild_to_exact_predecessor_counters ... ok
test storage::tests::media_ref_projection_acceptance_tests::dry_run_borrows_exact_proof_then_authoritative_commit_takes_its_owner ... ok

test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 2637 filtered out; finished in 0.31s
```

New action-hosted child commit-identity regression:

```text
$ cargo test --lib action_hosted_child_media_proof_refuses_swapped_commit_identity -- --nocapture
running 1 test
test local::tests::action_hosted_child_media_proof_refuses_swapped_commit_identity ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2647 filtered out; finished in 0.04s
```

Dedicated None-collapse regression:

```text
$ cargo test --lib previous_none_collapses_refuse_missing_generation_and_concrete_commit_identity -- --nocapture
running 1 test
test storage::tests::media_ref_projection_acceptance_tests::previous_none_collapses_refuse_missing_generation_and_concrete_commit_identity ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2647 filtered out; finished in 0.01s
```

Manifest media-generation refusal:

```text
$ cargo test --lib media_ref_manifest_tests -- --nocapture
running 1 test
test manifest::media_ref_manifest_tests::generated_media_contract_rotates_identity_demotes_rqs_and_refuses_actions ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2647 filtered out; finished in 0.00s
```

Complete client package chain:

```text
$ env -u FORCE_COLOR SNAPBACK_CLIENT_RQS_DIR=/tmp/rqs-f2 npm test --workspace @expo/snapback-client
> @expo/snapback-client@0.1.0 pretest
> node generated-mutation-ir.test.mjs && node commands.test.mjs && node reference-kind.test.mjs && node remediation.test.mjs

ℹ tests 2
ℹ pass 2
ℹ fail 0
commands.test.mjs: command phase/outcome, retry, cancellation, residue, and authority cases passed
ℹ tests 2
ℹ pass 2
ℹ fail 0
remediation.test.mjs: version, tolerance, registry-axis, and hash-binding cases passed

> @expo/snapback-client@0.1.0 test
> node package.test.mjs && node export-parity.test.mjs && node client-diagnostics.test.mjs && node ir-evaluator.test.mjs && node local-read-admission.test.mjs && node optimistic-rebase.test.mjs && node optimistic-rebase-acceptance.test.mjs && node result-transform.test.mjs && node micro.test.mjs && node micro-operational.test.mjs && node push-registry.test.mjs && node attribution.test.mjs && node app-data.test.mjs && node assets.test.mjs && node assets-watch-authorization.test.mjs && node authorization-invalidation.test.mjs && node lifecycle-disposal.test.mjs && node bearer-rotation.test.mjs && node auth-exchange-concurrency.test.mjs && node password-auth.test.mjs && node webcrypto-fallback.test.mjs && node argument-validation.test.mjs && node reservation-retry.test.mjs && node search.test.mjs && node external-store.test.mjs && node evaluation-floor.test.mjs && node sender-proof.test.mjs && node sender-transport.test.mjs && node connection-open-stream-reset-retry.test.mjs && node hosted-browser.test.mjs && node hosted-ephemeral.test.mjs && node ephemeral-room.test.mjs && node rqs-digest-parity.test.mjs && node mixed-route-v2.test.mjs && node rqs-store.test.mjs && node rqs-store-file.test.mjs && node rqs-store-v3.test.mjs && node logout-v3-bridge.test.mjs && node materialization-store.test.mjs && node materialization-bridge.test.mjs && node registration-ledger.test.mjs && node answer-classes.test.mjs && node carrier-capability-honesty.test.mjs && node demand-broker.test.mjs && node store-policy.test.mjs && node store-runtime-wiring.test.mjs && node lease-convergence.test.mjs && node outbox-store.test.mjs && node outbox-custody.test.mjs && node outbox-drain.test.mjs && node outbox-quarantine.test.mjs && node rqs-resume.test.mjs && node rqs-resume-native.test.mjs && node rqs-resume-memory.test.mjs && node rqs-store-expo.test.mjs && node rqs-resume-expo.test.mjs && node bundle.test.mjs && node browser-closure.test.mjs && node wire-version.test.mjs && ../../node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler exact-reference-types.fixture.ts push-registry-types.fixture.ts

snapback client outbox store tests pass
ℹ tests 56
ℹ pass 56
ℹ fail 0
ℹ tests 16
ℹ pass 16
ℹ fail 0
bundle.test.mjs passed
browser-closure.test.mjs passed
snapback-client wire-version tests passed
```

The complete chain exited 0. Notable exact changed-suite counts were 56/56
outbox-store and 16/16 outbox-custody; all chained scripts passed.

Reference-kind suite:

```text
$ env -u FORCE_COLOR node packages/snapback-client/reference-kind.test.mjs
✔ every wrong generated reference/verb pair refuses before transport (12.705083ms)
✔ missing, future, and malformed object kinds refuse every verb before transport (1.476792ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 25.797292
```

Reference validation:

```text
$ ./ref-check --verbose
ref-check: ok — 245 LLP docs, 5968 refs in 13560 files, 0 errors, 0 unchecked
```

`git diff --check` is silent with exit status 0.

## Deviations

- No implementation or verification deviation from the charter.
- Accepted LLP text was not changed because these edits conform the existing
  implementation to LLP 0244 D1 and LLP 0238 D1 rather than introduce a new
  design decision.
- Existing unrelated untracked charter, review, report, and log files were left
  intact.
- This fixer performed no commit, push, or rebase. While final verification was
  running, another process in the shared worktree committed and then amended
  these changes as `a0a1e29114e3b0e6031ae4f089dc8a04f9df4260`; the reflog
  attributes that external operation to `Snapback Test <snapback-test@example.invalid>`.
