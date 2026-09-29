# AG round 1 failure attribution

## Regression controls (ours, intentional)

- `pre-fix-lang.log`: `upsert_advice_withholds_effectful_keys_and_patch_values`
  fails because round 0 offers the reset-effect rewrite;
  `count_alias_orders_aggregate_rows_before_index_planning` fails with
  `E_SCHEMA_CONSTRAINT: undeclared column count`. Eight existing tests pass.
- `pre-fix-cli.log`: `first_paste::terse_check_counts_and_explains_search_behavior_warnings`
  fails because the round-0 verdict omits the search-note count and output.
- `key-guard-mutation.log`: deleting the stable-key guard makes
  `upsert_advice_withholds_effectful_keys_and_patch_values` fail specifically on
  `resetKey(message)`. The guard is restored; final tests pass with it present.

## Development/setup failures (ours, resolved)

- `fixed-lang.log`: the new direct-read test originally used a bare presence
  assertion, which Quarry refuses without `else NOT_FOUND`. Corrected the
  fixture; `fixed-lang-2.log` passes all ten tests.
- `affected-cli.log`: command used nonexistent targets `check_fix`/`cost`.
  Correct names are `fix`/`check_cost_source`; `affected-cli-2.log` passes
  80 check, 10 cost, 3 notes, 27 fix and 28 scale tests.
- `affected-lang-guide.log`: command used nonexistent language target
  `residency`; corrected to `residency_notes`.
- `affected-lang-guide-2.log`: `every_card_introduces_the_feature_before_examples_and_reference_details`
  failed because search-warning flags/codes preceded the first example. Moved
  the paragraph after it. The same run also failed
  `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`.
- `affected-lang-guide-final.log` and `affected-lang-guide-pass.log`: that
  word-budget test still failed, 18,300 -> 12,813 words (maximum 12,810).
  Initially shortened new prediction/maintains wording, but those cards are
  outside this particular census. The overage is AG round-0 wording composed
  with the longer reads card restored by the LV revert; treat it as **ours to
  reconcile**, not an exemption. Shortened AG's language-card alias sentence;
  all 98 guide tests then pass in `affected-lang-guide-final-pass.log`. No
  budget, fixture, original compiled example or fact-home requirement changed.
- Read-only orientation lookups initially guessed `.md` for embedded guide
  cards and an incorrect LLP 3000.024 filename; corrected to the actual `.rs`
  cards and `3000.024-global-search-beyond-one-read.rfc.md`. No product effect.

The initial merge's two documentation conflicts were resolved by preserving
both sides, including SQ's section and all journal entries.

## Late Grok regression controls (ours, intentional)

- `grok-pre-fix-lang.log`: `cal24_complete_job_is_preserved_by_pasting_the_unused_preview_replacement`
  fails because the caret is column 17 in the helper, not column 1 on the
  query declaration. `row_valued_positional_upsert_keys_receive_no_speculative_id_rewrite`
  fails because a complete insert image receives `id = row` advice.
- `grok-pre-fix-cli.log`: `first_paste::failing_check_keeps_the_terse_prediction_reason`
  fails on empty prediction output; `b2_maintain_note_points_to_the_measured_cold_snapshot`
  fails on the summary containing only the count, without view names.
- Additional read-only source/LLP filename guesses and one documentation patch
  against mismatched context failed during orientation/editing. Corrected the
  paths/context; no product or test failure is attributed to these tool errors.

## Late Grok affected-check repairs (ours, resolved)

- `grok-affected-cli.log`: `b2_predicts_assertion_refuses_check_and_is_quiet_when_satisfied`
  still expected empty stdout on failure. Updated it to require the restored
  dispatch prediction reason.
- `grok-affected-cli-final.log`: the first assertion edit matched the wrong
  empty-stdout assertion. This caused the same prediction test plus
  `check_reports_all_narrowing_sites_in_text_and_json_without_adopting` to fail.
  Restored the unrelated adoption assertion and updated the intended prediction
  assertion with specific surrounding context. This was a test-edit error,
  not a product-code change; the next affected run is `grok-affected-cli-pass.log`.

## Full suite

The single full-suite run exited 0. Exact summary:

```text
== 0 failure(s) in 1428 s
```

Every stage passed. **Ours: 0; baseline: 0; environmental: 0** full-suite
failures. The client stage reports 4,561 passed and 10 declared skips across
its shards; all 79 final client-model tests pass. The suite's 60-second target
is still missed, as in prior records; no ceiling or timeout was changed.

Grok arrived after the full run's Rust inventory was compiled. The late delta
has separate passing language/whole-guide/lowering, CLI, device and two-client-
expectation evidence. All development failures above are resolved; no
unaddressed test failure is being reclassified as a baseline exemption.
