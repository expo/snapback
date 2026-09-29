# Round 2 failure attribution

## Expected detecting controls (ours, not baseline/environment)

- `pre-fix-final-regressions.log`: two failures against round-1 source:
  `mixed_key_upsert_advice_cannot_change_existing_row_identity` observes **two rows**
  after pasting the advice with existing id A/tag B; `count_alias_predicates_and_keys_keep_real_group_column_precedence`
  gets `E_SCHEMA_CONSTRAINT: undeclared column count`. Both pass with the fix.
- `pre-fix-guide.log`: `check_output_guidance_distinguishes_summaries_from_verbose_details`
  rejects the old bounds wording. The updated guide passes.
- `dropped-group-filter-detecting.log` and `dropped-group-filter-final.log`: deliberately deleting the printed
  groupByTitle group predicate makes both memory and SQLite witnesses return
  `0-dm` instead of `a`. The restored rewrite passes both witnesses.
- `dropped-cursor-control.log`: deliberately deleting `after c` removes the cursor;
  both device witnesses fail at the required continuation. Restoring it passes
  a first page of a–e and the continuation containing only f. This addresses
  Grok’s additional test-strength observation.

## Development/setup failures (ours, corrected)

- Initial edit command used root-relative paths with snapback4 as cwd; Python
  found no file and no edit occurred. Removed the resulting empty nested directory.
- `pre-fix-lang.log`: new mixed-key fixture used `sync all`; corrected to `sync public`.
  The count test already detected undeclared count.
- `pre-fix-lang-confirmed.log`: whole-row JSON equality included private deadline
  metadata; now assert the four application fields. Count again detected the bug.
- `pre-fix-lang-detecting.log` / `fixed-lang.log`: an extra absent-row probe assumed
  upsert inserts a supplied id; its existing minting behavior invalidated that
  assumption. Retained Astra's existing-row execution probe. A normalization
  experiment was discarded; final code withholds mixed-key advice. The count test
  also assumed value-pinned id-order rankings were accepted; they are deliberately
  refused. It now proves alias/canonical diagnostic equality for those forms,
  and executes accepted predicates with real-column precedence and equal meters.
- `dropped-group-filter-control.log`: Rust Value is not JSON-indexable; fixed
  the witness to use field("id") and wire::to_json before the detecting rerun.
- `guide.log`: two stale prose expectations failed: `w9a_held_search_leads_with_coverage_then_cost_then_refusal`
  and `familiar::every_moved_fact_has_its_why_or_details_home` (reads-33).
- `affected-lang-guide-final.log`: another stale fact-home string (writes-23-2)
  failed the latter test. Both fact-home entries now reflect verbose output.
- `affected-lang-guide.log`: mistyped test target ephemeral_compatibility;
  corrected to ephemeral_compat before running.
- `affected-cli.log`: mistyped targets cost/notes; corrected to
  check_cost_source/check_notes before running.

## Full suite

Ran scripts/test.sh once, exit 0. Exact summary:

```text
== 0 failure(s) in 1354 s
```

Every stage passed. Full-suite failures: **ours 0, baseline 0, environmental 0**.
The client stage passed 4,561 tests with ten declared skips; all 79 model tests
passed. Final affected checks and all 99 guide tests pass. No unresolved failure.
The pre-existing 60-second suite target remains missed; no budget was changed.
