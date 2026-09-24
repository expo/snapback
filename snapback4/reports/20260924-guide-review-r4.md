# Lane F round 4 — exact write refusals and actionable why excerpts

Date: 2026-09-24. Branch: `sb4-intent/f-guide`.
Starting commit: `27a2491fe`.
Implementation commit: `10927d7d3`.

The `E_RULE` excerpt states both hidden-collision cases without referring to
the later matrix. Ordinary insert, including `if absent`, returns `E_RULE`.
An update or upsert-patch with a readable target returns `E_RULE`; an unreadable
target returns `NOT_FOUND` without row, index, column or branch details. The
paragraph also carries the readable-target detail policy and the blind-write
recovery advice. The registry summary now states the same distinction.

No engine or compiler behavior changed. Bob's `unrepost` test is left to the
integration branch as requested. Nothing was pushed or published.

## File map

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/guide/rules.md` | Makes the first `E_RULE` paragraph self-contained; adds audience/authority repair advice to the aggregate-delta note. Retains the existing matrix. |
| `crates/snapback4-lang/src/guide/codes.rs` | Corrects the `E_RULE` summary to distinguish target readability. The paragraph selector is unchanged. |
| `crates/snapback4-lang/src/guide.rs` | Adds offline-read recovery, residency-note decisions and asset recovery facts to the selected paragraphs. |
| `crates/snapback4-lang/src/guide/actions.rs` | Adds revoked-admission recovery and missing-secret repair. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Adds smaller-page, narrower-predicate and job-sweep repairs to the ceiling definition. |
| `crates/snapback4-lang/src/guide/effects.rs` | Adds worker-generation recovery and cancellation's external-outcome boundary. |
| `crates/snapback4-lang/src/guide/maintains.md` | Adds recorded-field payload repair and a response to unwanted aggregate disclosure. |
| `crates/snapback4-lang/src/guide/native.rs` | Adds trap repair and the committed/failed chunk distinction before replacement work. |
| `crates/snapback4-lang/src/guide/personas.rs` | Adds rate-limit retry guidance. |
| `crates/snapback4-lang/src/guide/prediction.rs` | Gives the two repairs for a failed `predicts` assertion. |
| `crates/snapback4-lang/src/guide/refusals.rs` | Adds process-event inspection and distinguishes normal shutdown from repair work. |
| `crates/snapback4-lang/src/guide/search.rs` | Adds grouped-search, held-query and Unicode-host repairs. |
| `crates/snapback4-lang/src/guide/sync.rs` | Adds the confirmed-restore recovery boundary. |
| `crates/snapback4-lang/src/guide/types.rs` | Adds the nonzero-divisor guard. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pins the full `E_RULE` excerpt and extends the census to reviewed recovery and boundary facts. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Stores 384 reviewed facts for all 195 registered codes. |
| `crates/snapback4/tests/check.rs` | Tests the actual CLI `why E_RULE` summary and card excerpt separately. |
| `JOURNAL.md` | Appends the dated round-4 qualification entry. |
| This report | Records the file map, audit, regressions and results. |

## Audit and regression design

Reviewed the selected paragraph for every registered code, including notes and
process events. The new 195-code action census supplements the definition
census with 384 explicit facts. These cover recovery, retry identity, authority,
visibility, terminal or parked work, and relevant declaration decisions. Codes
with a complete definition and repair needed only a new test expectation.
The table above lists the paragraphs that needed additional recovery facts.

The census checks the actual bounded card excerpt, excluding the registry
summary. It also checks that CLI and repeated diagnostics select the same
text. A new registered code must receive both a definition pin and reviewed
action/boundary facts. Expected text is maintained separately from the
paragraph selector; the test does not learn its expectations from the output.

`why_rule_carries_the_target_visibility_contract` checks ordinary insert,
if-absent insert, readable and unreadable update/upsert collisions, private
detail withholding, missing targets, incomplete insert patches, readable
conflict details, read hiding and blind-write recovery. The CLI test separately
checks the public summary so a correct excerpt cannot mask a wrong summary.

The existing engine regression
`wa2_secondary_hidden_collision_does_not_borrow_target_authority` executes
updates and upserts against readable and hidden targets, checks the exact
refusals, withholds private values and verifies rollback. It passed unchanged.

Eight isolated negative controls failed at the intended assertions:

1. Restore the old `E_RULE` paragraph, retaining the matrix.
2. Remove the readable/unreadable collision distinction from the excerpt.
3. Remove the private-detail withholding clause from the excerpt.
4. Remove the ordinary/if-absent insert collision exception from the excerpt.
5. Restore the old registry summary while retaining the corrected excerpt.
6. Remove the original-request-ID advice from `E_STORE`, retaining its definition.
7. Remove the no-resume boundary from `E_STEP_PARKED`, retaining its definition.
8. Revert the added recovery advice outside `rules.md` and `codes.rs`.
   The census reports 45 missing recovery/boundary facts.

A positive control removed the later readable/unreadable matrix and hidden-
collision paragraph. The `E_RULE` excerpt test still passed: the selected
paragraph now carries those facts itself. All temporary changes were restored
byte-for-byte before final qualification. No engine mutation was needed.

## Forms and scope

This round adds no Quarry form or compiled block. Existing examples and card
introductions remain unchanged. Examples still taught and exercised include
`upsert counters[recipient] { count: 1 }`, predicate reads, planned Global and
materialized Following views. No authorization, disclosure, durability or meter
behavior changed.

All 25 Quarry blocks in the 14 edited guide sources are byte-identical to the
starting commit. All 29 card leads are preserved: 25 rendered comparisons and
four unchanged card source files. The largest changed Rust source is 1,454
lines. README remains 292/300 lines; no budget changed.

The additional card edits implement the requested all-code audit. No round-4
scope deviation or newly open problem was found.

The inherited full-history search example still emits its asserted
`N_NO_HORIZON` note. Reproduce by copying the first Quarry block from
`crates/snapback4-lang/src/guide/search_all.md` into an empty project's
`snapback/schema.q` and running `snapback4 check`. The existing
`every_card_compiles_clean` test pins the `search`, block 1 exception. Its
source and exception remain unchanged. No new exception was added.

## Qualification

- Frozen Bun install passed: 506 installs across 500 packages, no changes.
- Final restored-source guide tests: **67 passed, 0 failed**.
- Final restored-source CLI check/why/diagnostic tests: **69 passed, 0 failed**.
- Existing hidden-collision engine regression: **1 passed, 0 failed**.
- All 195 CLI explanations fit the 4,096-byte output bound. The largest is
  4,094 bytes; `E_RULE` is 1,495 bytes. The census checks the bounded output.
- `git diff --check` passed.
- WASM remains 1,744,842 B raw / 484,967 B gzip, below the unchanged 486,000 B
  budget. README remains 292/300 physical lines.

One full `scripts/test.sh` run: **`== 0 failure(s) in 375 s`**, exit 0.
No introduced, baseline or environmental suite failures; the complete log has
no failure markers. Client tests: **1,088 passed, 10 skipped, 0 failed**.

During test-data authoring, the coverage check caught five missing step-code
entries and three literal wording mismatches; these introduced test-data
failures were corrected before qualification. The negative-control failures
above were intentional and their temporary edits were restored.

Logs are under `~/sb4-intent/`: `lane-f-r4-bun.log`, `lane-f-r4-guide.log`,
`lane-f-r4-check.log`, `lane-f-r4-collision.log`, `lane-f-r4-suite.log`,
`lane-f-r4-mutations.log`, and `lane-f-r4-mutant-*.log`.
