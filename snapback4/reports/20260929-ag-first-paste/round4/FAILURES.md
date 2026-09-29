# Round 4 failure attribution

## Full suite

Ran scripts/test.sh exactly once, exit 1. Exact summary:

```text
== 1 failure(s) in 1381 s
   cargo test
```

Every full-suite failure:

- **Ours:** `snapback4-device::readauth`, `census::authoring_census` failed
  (80 passed / 1 failed). The new fourth prediction-card block adds exactly
  `card/prediction/4:setReaction | eligible` to the compiled authoring corpus.
  `census-delta.txt` proves one added entry and zero removed entries; there are
  still 57 distinct private write sites. Reviewed `census.rs` and `outcomes.rs`:
  this example has uniformly readable public-parent outputs and adds no private
  outcome case. Updated the expected census with that one line. The full
  readauth target passes **81/81** in `census-repair.log`.

No other test or script stage failed: ours 1 (fixed), baseline 0,
environmental 0. All 4,561 client tests, 79 client models and nine fixture-wrapper
tests passed; ten client tests were skipped. The original failure remains part
of the single full-suite result. Model E_AUTH console lines are expected
negative-case observations, not test failures.

## Detecting controls and development checks

All entries below are **ours**, not baseline or environmental failures.

- `pre-fix-cli.log`: the initial exact test selector omitted the `first_paste::`
  module prefix and ran zero tests. It supplies no regression evidence; corrected
  in the two following runs.
- `pre-fix-cli-detecting.log`: the new CLI test failed against the old compiler
  on the missing precise guide pointer in default output. Expected red control.
- `pre-fix-no-rewrite.log`: the finalized test failed against the old compiler
  specifically on its printed `rewrite:` line after the read-through upsert
  reason in `why save`. This fixture was otherwise eligible for the old generator.
  The affected CLI run passes after its removal.
- `mutant-len-ownership.log`: temporarily let `len` override an explicitly
  declared helper while retaining the `length` ownership guard. The existing
  extended alias test fails with E_QUARRY_TYPE because count(int) is invalid.
  This is the exact review gap; the mutation was restored in a finally block.
- `affected-lang-guide.log`: four guide tests failed (95 passed):
  `prediction_card_compiles_clean` and `every_card_compiles_clean` rejected
  N_NO_HORIZON on the new example's unbounded public parent;
  `w9b_every_code_has_bounded_card_context_and_a_full_card_command` and
  `familiar::every_moved_fact_has_its_why_or_details_home` rejected the
  E_NOT_PREDICTABLE explanation at 4,262 bytes. Added a finite parent cap in
  the example and shortened the new pointer text.
- `affected-lang-guide-final.log`: the same two explanation-size checks still
  failed at 4,114 bytes (97 passed). Shortened the new pointer again.
- `affected-lang-guide-pass.log`: the contextual fact-home check still exceeded
  the size limit with the longer `offline-interactions` keyword (98 passed).
  The final short pointer retains the same destination. The complete guide
  now passes all 99 tests in `affected-lang-guide-verified.log`.

No existing guide fact or compiled block was removed, and no budget was raised.
Cargo stopped each failed multi-target invocation at its guide test binary;
those runs are not claimed to have executed later targets. Final affected
checks and the full suite qualify the restored, final product source.

The first staged whitespace check found one extra blank line at the end of
`census-delta.txt` (**ours**, report formatting only). Removed it before the
successful staged check and commit; no test result or source changed.
