# Lane A — round 10 nullable/enum delta

All six review items are addressed. This round changes compilation and tests;
it does not change engine authorization, disclosure, scan admission, meters or
cursor eligibility. No push, publication or version bump.

## File-by-file changes

- `crates/snapback4-lang/src/bind/intent_aggregates.rs`: records unpaged
  aggregate consumers and required argument bindings by read site. Shares a
  present, infallible endpoint proof with ordinary read planning and binding.
  Integer interval proofs permit safe arithmetic within the existing I53
  range; division, optional values and unproved operations remain residual.
- `crates/snapback4-lang/src/bind/intent.rs`: preserves streaming aggregate
  domains, applies endpoint proofs before extracting seeks, and commits lane
  plans/index requests only after proving prefix authorization. Declined
  optimizations keep the original ordinary scan without unused lane indexes.
- `crates/snapback4-lang/src/bind/intent_lanes.rs`: conservatively proves that
  every source-row column used by a read rule is pinned in every proposed
  lane, including nullable fallback lanes. Derived readability without a
  proof also declines lane expansion.
- `crates/snapback4-lang/src/bind/program/reads.rs`: the speculative named
  shape check knows it is in a predicate. Binding can extract additional safe
  seeks once local/helper/lane selector types are known, using the same
  endpoint proof; guarded nullable and fallible endpoints stay in the filter.
- `crates/snapback4-lang/tests/intent_delta10.rs`: six new regression tests
  for streaming totals, parenthesized predicates, continuation and guarded
  endpoints, detailed below.
- `crates/snapback4-lang/tests/intent_predicates.rs`: strengthens the eight
  versus nine variant boundary; exercises exclusion of `doing` and retained
  nullable `todo`, plus retained data for both enum sizes.
- `crates/snapback4-lang/tests/intent_nulls.rs`: replaces the old non-uniform
  merge/no-cursor expectations with an ordinary scan and a terminal cursor
  round trip. Authorization and incomplete-result assertions remain.
- `crates/snapback4-lang/tests/intent_target.rs`: accepts the now-streaming
  unpaged membership count. Existing view aggregate refusals remain tested.
- `crates/snapback4/tests/scale.rs`: the language card's `roomHour` and
  `roomWindow` endpoints contain calendar calls and potentially overflowing
  arithmetic. They now retain filters, and their certificates correctly say
  work grows with the room. Tests assert that plan and classification.
- `crates/snapback4-lang/src/guide/reads.rs`: documents safe endpoints,
  parenthesized named shapes, conditional lane extraction, continuation and
  streaming aggregate residuals; adds a compiled named-shape example.
- `llp/3000.013-quarry-states-intent.rfc.md`: records the optimization
  boundaries in §§2.1 and 5.1.
- `JOURNAL.md`: appends this round's dated changes, measurements and limits.
- This report records the review disposition and verification.

## Forms compiled and executed

```quarry
count(t where .status != 'done')
sum(t where .status in ['todo', 'doing'], .n)
tasks first 10 by .id after c where (.due < now) card
t where .status != 'done' first 1 by .createdAt after c
t where .status in ['todo', 'doing'] last 1 by .createdAt after c
t where d != 0 and .at > 10 / d first 50 by .at after c
t where x != null and .at < x first 50 by .at after c
t where .at > start + 0 first 50 by .at after c
```

The two totals stream without a schema cap and return null on a meter cut.
The unpinned page forms keep an ordinary scan under `.orgId = viewer`, visit
all three authorized rows through cursors, and retain `complete: false`.
Zero `d` and null `x` produce empty complete pages without evaluating their
guarded endpoints. Required `start + 0` still becomes a seek.

## Regression evidence

1. `unpaged_enum_count_and_sum_compile_without_caps`: count and sum, both
   complement and explicit membership, use meter-bounded streaming scans.
   `todo` and `doing` contribute 4/12; `done` contributes nothing.
2. `interrupted_enum_totals_never_publish_a_partial_number`: an examined
   ceiling of one over four rows returns null, incomplete and no cursor for
   both totals and both spellings.
3. `parenthesized_nullable_predicate_accepts_a_named_page_shape`: the exact
   reported spelling compiles and returns only the past non-null deadline.
4. `unpinned_enum_complements_and_value_lists_keep_continuations`: both
   spellings page `a1`, `a2`, `a3` to termination, one row at a time in both
   directions, including tied timestamps and Bob's interleaved hidden rows.
5. `ordered_seek_endpoints_respect_short_circuit_guards_and_narrowing`:
   division by zero, optional endpoints and potential overflow stay residual
   under explicit `by .at`; false guards return nothing, true guards return
   the matching row, and null scanned-row values never match.
6. `present_and_proven_safe_arithmetic_endpoints_still_seek`: required values,
   `start + 0`, constant arithmetic and negation retain seeks, examine at most
   one matching row, and skip nulls and the nonmatching prefix.
7. The strengthened enum test proves eight variants expand and nine remain
   residual, with retained data. Removing only `variants.len() > 8` makes the
   nine-variant assertion fail. Excluding `doing` and preserving nullable
   `todo` are also exercised.

Restoring the pre-fix compiler (`49131c3eb`) makes the first five new tests
fail: aggregate admission, partial totals, named shape, lost continuation and
unsafe endpoint extraction. The sixth is a positive optimization safeguard.
The compiler sources were restored after this deliberate regression run.

## Decisions and limitations

- Chose the explicitly permitted residual streaming scan for unpaged
  aggregates. The existing streaming IR folds an admitted scan; a bounded
  merge changes the consumer's meaning. A streamed union would require a
  separate engine implementation and interruption proof, so none was added.
- The existing `in` path had the same uncontinuable non-uniform page as enum
  complements. Both now fall back together. The prefix proof is deliberately
  conservative and may decline an optimization the runtime could prove by a
  more sophisticated rule analysis. It never grants extra visibility.
- Guarded optional endpoints remain residual; no guard-hoisting mechanism
  was added. Calls and arithmetic without a complete overflow proof also
  remain residual. This can increase examined work (not its meter ceiling),
  including the two calendar examples listed above.
- No requested reproduction remains unresolved. Existing view-aggregate
  admission limits and authored merge semantics are unchanged.

## Verification

- `bun install --frozen-lockfile`: passed, no dependency changes.
- Affected language integration tests: 118 passed (guide 57, aggregate safety
  5, round 10 regressions 6, followup 5, nullable lanes 7, order 3, predicates
  7, earlier review 7, target 21). Aggregate planner unit tests: 4 passed.
- Device `intent_views`: 16 passed, across memory and SQLite.
- CLI `scale` and `scale_intent`: 24 passed, including the residual
  certificate regression from the previous round.
- `scripts/test.sh`: **`== 0 failure(s) in 153 s`**, exit 0. All Rust targets
  passed; client tests reported 1,054 passed, 10 skipped. Full log:
  `/tmp/lane-a-round10-full-suite.log`. No introduced, baseline or environmental
  failures in this full-suite run.
- The initial targeted runs exposed four expectations deliberately changed
  by these fixes, all ours and resolved:
  `nullable_value_lanes_page_in_both_directions_with_words_and_projection`,
  `nullable_lists_preserve_membership_deduplication_authorization_and_cuts`,
  `domains_views_and_aggregates_keep_scan_admission`, and
  `language_operation_classes`. Their replacements assert streaming
  semantics, continuation, and truthful growing-work certificates as
  described above. No unrelated baseline test was repaired.
- The deliberate pre-fix regression run and nine-variant mutation run failed
  as expected. Logs: `/tmp/lane-a-round10-before.log` and
  `/tmp/lane-a-round10-nine-mutant.log`.
- `git diff --check`: passed. Every changed source file remains below 1,500
  lines. Web wasm remains 1,744,842 raw / 484,967 gzip bytes, within the existing
  486,000-byte budget; no budget was raised.
- Separate inherited audit problem: `./ref-check --verbose` reports one
  broken reference at `snapback4/crates/snapback4-core/src/store.rs:809`,
  `LLP 3000.013#5.3-effects-keyed-once`. It is identical at this round's base
  `49131c3eb`, and was already reported in the previous round; the correct
  anchor is `#5.3`, already fixed on newer upstream. Reproduce by running
  `./ref-check --verbose` in this branch. Audit log:
  `/tmp/lane-a-round10-ref-check.log`. This unchanged core line is outside
  the diff and the blocking suite.
