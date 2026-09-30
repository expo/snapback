# QX round 1 failure ledger

The requested full suite was one invocation; its completed outcome is below. Earlier invocations are retained, including harness mistakes.
“Baseline” below means an intentional round-0 control; those defects belong to
this lane's earlier work. No inherited-main failure is currently identified.

## Intentional round-0 controls — baseline (QX's round-0 defects)

- `before-constraints.log.gz`: `generated_constraints_memory` and
  `generated_constraints_sqlite` fail. 24 of 120 cases wrongly predict a changed
  constraint population (12 per store). Each detecting case also observes the
  changed row. Insert arms, unchanged constraints and expiring-cap controls
  already pass. Final same tests pass in `final-constraints.log.gz`.
- `before-device-tiers.log.gz`: four failures — wasm unique, wasm cap, process
  unique, process cap (`held upsert queues before entering uncovered …`). The
  original six controls pass. All ten pass in `final-device-tiers.log.gz`.
- `before-diagnostic.log.gz`: `mismatched_audiences_keep_sync_code_and_schema_specific_repair`
  fails against round 0's generic repair. Final four variants pass.
- The two new residency snapshots differ on the exact saved round-0 binary.
  `before-snapshots.log.gz` is a successful negative-control verifier: it checks
  that both old outputs fail the current snapshot, and that reverting only
  the intended header/prose additions exactly restores the old output.

## Corrected implementation and expectation failures — ours

- `harness-proof-placement.log.gz`: `E0425` (`effect` unavailable). The initial
  unique guard landed in the earlier insert-if-absent loop; moved it to
  `check_constraints` beside the changed-key check. It never built or ran.
  A wrong-working-directory repair attempt repeated the same compile failure;
  the subsequent repair and all actual-device tests use the correct location.
- `affected-lang-guide.log.gz`: three guide failures:
  `definitions::w11_every_registered_code_quotes_its_definition` (new E_SYNC
  mention selected the wrong excerpt),
  `familiar::every_moved_fact_has_its_why_or_details_home`, and
  `w9b_every_code_has_bounded_card_context_and_a_full_card_command` (the expanded
  E_NOT_PREDICTABLE card was 4,292 B, over its existing size limit). Moved the
  new sync wording after its defining paragraph and shortened redundant prose.
- `guide-wording.log.gz`: the definition test still needed the explicit boundary
  “eligibility is not a promise that every call produces a predicted row”.
  Restored that sentence without increasing the size budget.
- `diagnostic-early-path.log.gz`: the mismatch test still reached an earlier
  bind-sync refusal. Applied the schema repair there, keeping E_SYNC.
- `diagnostic-planned-horizon.log.gz`: the repair printed the planned horizon
  containing `.$parent.group`; use the original authored declaration. The
  final test checks exact text and compiles all four repaired declarations.
- `old-residency-expectations.log.gz`: two stale-output failures:
  `insert_arm_rule_and_cap_causes_have_applicable_guidance` and
  `insert_arm_nullable_unique_image_distinguishes_null_from_a_known_lookup`.
  Their exact summary expectations needed the new per-constraint prose.
  Final residency target passes 41/41.

## Corrected harness/build setup failures — ours

- `harness-compile.log.gz`: the Rust test used nonexistent `Failed.refusal`, and
  omitted the variant's other fields (`E0026`, `E0027`). Use `why, ..`.
- `harness-type.log.gz`: missing collection type annotation (`E0283`). Specify
  `Vec<(String, Value)>`.
- `harness-device-tiers.log.gz`: four new JavaScript cases read `refusal.code`
  instead of `why.code`; six original cases passed. Corrected before the
  retained detecting run.
- `harness-ambiguous-key.log.gz` and `harness-refusal-code.log.gz`: both generated
  tests expected only E_RULE/E_CONSTRAINT, while an upsert insert's hidden
  collision may produce NOT_FOUND. Accept that valid server refusal too;
  the four direct review reproductions still assert exact E_RULE/E_CONSTRAINT.
  The fixture now uses named parent/principal keys so extra same-arity keys
  cannot make the intended target ambiguous.
- `harness-default-syntax.log.gz`: both tests reached an invalid fixture column
  default (`time = …`); changed to Quarry's `time default …`.
- `harness-horizon-expectation.log.gz`: the two generated tests contained the
  intended baseline failures plus an incorrect expectation that a natural
  held update queues under a child horizon. Unchanged constraint populations
  need no new coverage; corrected that oracle before `before-constraints.log.gz`.
- `harness-test-target.log.gz`: requested a nonexistent standalone `upsert`
  target. It is a module of `--test device`; final filtered run passes 31/31.
- `pre-sdk-*`: successful timing runs with stale packaged SDK/wasm, caught by
  source/package hash comparison. These are superseded measurements, not
  final timing evidence. Rebuilt the SDK, verified equal wasm hashes, repeated
  both complete 20-trial tiers and reran all ten device cases.

Several initial read commands used nonexistent paths, and one patch application
failed to match its context. They changed no product state. The journal merge
conflict was resolved by retaining both complete entries. No environmental test
failure has been identified; no timeout, count, resource or size limit was relaxed.

Staged whitespace check also reported raw test-runner blank/trailing whitespace
(`staged-whitespace.log.gz`, ours). Logs were compressed losslessly, preserving
the raw evidence; no product source or test setting changed.

## Single full suite

Exit 0. Exact summary: `== 0 failure(s) in 1312 s`.
All 13 stages pass. Ours: **0**. Baseline: **0**. Environmental: **0**.
Rust 4,379 passes / 33 existing ignores; clients 5,345 passes / 10 existing skips;
models 79/79; fixture wrappers 9/9. No cancellations. The model's injected
E_AUTH refusals are expected fault branches, not test failures. Source stayed
unchanged during the full run. There was no full-suite rerun.
