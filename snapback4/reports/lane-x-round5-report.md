# Lane X — round-five aggregate repairs

2026-09-25 · `sb4-intent/x-familiar` · parent `918940521`.
Reviews: `~/sb4-intent/reviews/x-r4.astra.md` and
`~/sb4-intent/reviews/x-r4.grok.md`.

## Result and file ledger

A named-key candidate that fails to bind now gets one verified retry with
`first 1`, when a total unique key proves that the read contains at most one
row. The retry must compile in the same affected declaration and have the
intended page plan. A compiling candidate with the wrong plan does not qualify
for this retry. Valid existing point reads and multi-row pages keep their plans.

Candidate-specific advice is stored with the candidate. Verification publishes
the advice and replacement together; if no candidate verifies, the message
only explains the self-comparison and does not recommend a rejected named key.

All paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/repair.rs` | Distinguishes binding failure from a rejected proof; retries a total unique point key with `first 1`; verifies its page class; publishes only verified candidate messages. Adds a cardinality-guard unit test. |
| `crates/snapback4-lang/src/parser/predicates.rs` | Leaves the unconditional refusal factual and attaches argument/key advice to its corresponding candidate. |
| `crates/snapback4-lang/src/parser/repairs.rs` | Retains optional candidate messages and provides the exact-site/exact-replacement association. Existing source splices are unchanged. |
| `crates/snapback4-lang/src/guide/why/E_QUARRY_SELF_EQUALITY.md` | Documents the verified single-row page retry and suppression of unverified advice. |
| `crates/snapback4-lang/tests/familiar_verified_repairs.rs` | Adds five integration tests for aggregate repairs, rejected advice, capped and nullable-key populations, and invalid helper bodies. |
| `JOURNAL.md` | One dated append-only entry. |
| `reports/lane-x-round5-report.md` | This report and validation evidence. |

## Forms and executed results

These examples occur inside an enclosing member's row shape. Fixtures have
members `a`/`one` with score 10 and `b`/`two` with score 20; the non-id case
uses `unique conversation` without a competing non-unique prefix index.

| Original guess | Offered replacement for its inner read | Result after pasting |
|---|---|---|
| `count(members where .id = .id)` | `members[id = .id] first 1` | `count(members[id = .id] first 1)` returns 1 for each outer row. |
| `sum(members where .id = .id, .score)` | `members[id = .id] first 1` | `sum(members[id = .id] first 1, .score)` returns 10 and 20. |
| `count(members where .conversation = .conversation)` on a unique conversation | `members[conversation = .conversation] first 1` | Each row's count is 1. |
| The same unique non-id read under `sum` | `members[conversation = .conversation] first 1` | Each row's sum equals its own score. |
| `count((members[]) where .id = .id)` | `(members[id = .id]) first 1` | Balanced grouped source; count remains 1. Both columns and both aggregates are covered with grouping. |
| `count(members where .conversation = .conversation)` with a non-unique capped prefix | `members[conversation = .conversation]` | Two rows in the group produce 2, with no new page limit. |
| The nullable unique-key case with an existing prefix page | `members[conversation = .conversation]` | Two tied null keys both remain in the count: 2. |

The successful fallback message names the enclosing-row key and `first 1`.
`count(...) + true`, `sum(..., .active)`, and the otherwise unadmitted
`count(members[active = .active,] where .id = .id)` retain an empty rewrite
and factual message when neither candidate binds. The helper
`fn choose(active: bool): count(members where .active = .active) + true`
also gets an empty rewrite, with or without an external caller.

## Tests and mutation evidence

| New test | What it proves |
|---|---|
| `aggregates_retry_point_keys_as_verified_single_row_pages_and_execute` | Eight combinations of count/sum, id/non-id unique keys and direct/grouped reads emit a nonempty repair, compile when pasted, and return the expected values. Compilation is checked before exact text, so an unverified point repair fails at its actual type error. |
| `failed_key_candidates_have_neither_rewrite_nor_named_key_advice` | If both candidates fail, neither replacement text nor named-key advice is published. |
| `a_capped_nonunique_aggregate_keeps_its_whole_page` | A valid existing page is not limited to one row; the executed count remains 2. |
| `nullable_unique_aggregate_keeps_tied_null_rows` | Nullable uniqueness is not treated as a one-row population; the executed count includes both null rows. |
| `invalid_helper_body_cannot_offer_a_local_predicate_repair` | The exact invalid helper body is bound through its synthetic invocation, even without a caller, and its remaining `int + bool` error suppresses the rewrite. |
| `single_row_fallback_requires_a_total_unique_key` | The fallback generator rejects non-unique and nullable-unique keys and accepts a required unique key. |

Both requested source mutations were actually run, then restored in `finally`
blocks:

| Mutation | Observed failure |
|---|---|
| Keep deleting the sole `where`, but skip verification for a `count` candidate | Exit 101 in the aggregate execution test: the pasted `count(members[id = .id])` fails with `E_QUARRY_TYPE` because it receives a row rather than a page. |
| Delete `doc.programs.append(&mut parsed.programs)` from the synthetic helper invocation | Exit 101 in the helper-body test: the invalid helper leaks `where .active = active`. |

All earlier point/page, source-preservation, trailing-comma, optional-presence,
qualified-helper and prediction/visibility regressions remain in the suite.

## Decisions, compatibility and limitations

- The extra `first 1` is safe only when the named equalities cover `id` or a
  total unique key. This follows the existing total-unique definition: a plain
  unique index whose components are required. No nullable or multi-row
  population is truncated to manufacture a compiling repair.
- The retry runs only after a binding failure. Parse failures, missing proofs
  and changed-plan rejections still fail closed. The existing round-four
  compiling-wrong-plan tests continue to pass.
- The scope is unchanged: only the affected declaration is checked, with schema
  and helpers as context. Existing standalone-shape and helper-signature proof
  limitations remain. Adding `first 1` never bypasses the ordinary binder or
  admission checks.
- The existing planner can refuse a fully pinned extra-key page such as
  `members[active = .active,id = .id] first 1`. This round correctly withholds
  that candidate and its advice; it does not change planner admission.

No unresolved round-five finding or design deviation. No new spelling, code,
authorization, disclosure, durability, runtime meter, store, client-source,
Following, package-version, push or publication change. All edits remain source
splices; no AST is printed into a repair.

Development-only test failures were ours and corrected: an expanded fixture
initially expected an extra-key page which the existing planner refuses; the
unique-key fixture initially also declared a competing prefix index, making the
original keyed aggregate already a valid page; the nullable-unique fixture
similarly needed to assert its valid full-page count rather than an empty
rewrite. The final tests now distinguish these cases and verify their actual
results. No failure was waived as baseline or environmental.

## Guide measurements and mappings

The core cards and all 133 fact homes/17 original compiled blocks are unchanged.
Their tests still check the rendered homes and example hashes. Full original
mapping and guess replay:
[original lane report](lane-x-report.md#moved-fact-mapping).
This round's guess table is above.

| Card | Words before → after | Opening before → after |
|---|---:|---:|
| language | 5,686 → 4,798 | 4,059 → 128 |
| programs | 1,266 → 478 | 627 → 135 |
| reads | 3,933 → 1,843 | 1,715 → 168 |
| shapes | 1,415 → 537 | 1,415 → 93 |
| writes | 3,987 → 2,037 | 3,987 → 211 |
| types | 2,013 → 729 | 737 → 125 |
| **Total** | **18,300 → 10,422 (43.0% reduction)** | **12,540 → 860 (93.1% reduction)** |

Every opening remains reduced by at least two thirds. The added facts—verified
`first 1` retry, its cardinality requirement, and verified advice—live in
`why E_QUARRY_SELF_EQUALITY`.

## Validation

Restored-code targeted checks: **140 language/unit/guide tests** and **three CLI
tests**, all passed. Frozen Bun installation changed no dependencies. Rendered
`why E_QUARRY_SELF_EQUALITY`: **2,892 UTF-8 bytes**, below 4,096. Ref-check:
**509 LLP documents, 9,282 refs, zero errors and zero unchecked**. The external
Clique target checked successfully: **21 tables, 13 operations, zero problems,
six existing notes**. Every changed source file remains below 1,500 lines.

One full `scripts/test.sh` run, exit **0**, exact final summary:

```text
== 0 failure(s) in 574 s
```

Every blocking phase passed. Client tests: **1,519 total, 1,509 passed, ten
existing skips**. Client models: **78 passed**, preserving all **5,000 online
session / 5,000 local session / 3,000 online client sequences**. The wasm/native
familiarity witness passed. Wasm remains **1,775,799 B raw / 495,258 B gzip**,
under the unchanged **496,000 B** budget.

Final failures: **ours 0; baseline 0; environmental 0**. No full-suite failure
was waived or retried. The supplied baseline log was read before attributing
failures. The pre-existing 60-second wall-time target remains exceeded on this
shared host; no test count or threshold was reduced.

Implementation commit: **`d56014670`**. The report and journal are committed
separately, with the required co-author trailer on both commits. Nothing was
pushed or published.

Raw evidence remains on this host:

| Log | SHA-256 |
|---|---|
| `/tmp/lane-x-r5-suite.log` | `7d555c6a11b1594201b8b7d1544d2a5ad9d59d44e4fc7ef5a84813d357ee1d50` |
| `/tmp/lane-x-r5-lang-final.log` | `ee7279332d0f0365a21eb91b246b2a2174d9b1c8574879749eb066044fd029f9` |
| `/tmp/lane-x-r5-cli-final.log` | `88834489297b6c4ccf27ca76f9dfaa955614968ec7d9daa3de49358e4a2ee665` |
| `/tmp/lane-x-r5-mutant-count-verification.log` | `061932111dfed9e4defb10c60952d10b320be8bfc22a5bb7f3b515d6707e0761` |
| `/tmp/lane-x-r5-mutant-helper-invocation.log` | `6ed80d529df6346ba808410a706fac2182100710c34a6099e3528423b09fa929` |
| `/tmp/lane-x-r5-ref-check.log` | `86fa801a16f3c35b7f1f2737312b925932dd012cc03231f18db0bc3668423c24` |
| `/tmp/lane-x-r5-target.log` | `64f322306b06a75597df47c96614555872be6aa0d95ecf345144d29fc332fe10` |
| `/tmp/lane-x-r5-why.log` | `c81c3f9af9d61a501c34f9e9a849d2ed4ca4d7173fb136ec24cc56901cc1e658` |
| `/tmp/lane-x-r5-bun.log` | `c6e04c5db6795826146440f09225b10897392ebe8560f0c811716532393424a5` |
