# Lane AG — first paste, round 1

Started by fetching and merging origin/main (4fd338de5) into
sb4-intent/ag-first-paste. Merge 62258cab4 preserves both LLP revision entries,
AG's round-0 journal entry, the LV revert entry and SQ's entry/§20.24.4.
LLP 3000.029 remains Shelved. No push or publication.

## Review dispositions

Read Astra's complete NOT READY review at the start. Grok's file initially
contained progress only; its complete READY WITH CHANGES review arrived during
the single full-suite run. Read it in full and addressed all four findings,
including its blocking declaration-location issue. Late-change qualification
is explicitly separated from the full run below.

| Finding | Change and regression evidence |
| --- | --- |
| Medium: upsert patch effects move after existence selection | The advice now requires stable keys **and every patch/insert field value**. Calls, row reads, spreads and key-changing patches receive no branch rewrite. The reset helper deletes the existing reaction and returns its replacement emoji; the original upsert still commits exactly one row. A direct row-reading patch is also withheld. The regression fails against round 0's offered reset rewrite (`pre-fix-lang.log`) and passes with the fix. |
| Missing effectful-key control | An effectful `resetKey(message)` also deletes the row, and must receive no rewrite. Deliberately deleting the stable-key guard makes this exact case fail (`key-guard-mutation.log`); the guard was restored. |
| Medium: hidden search warnings | Plain check counts all search warnings in the verdict and gives each a concise behavior line. Rewrites and full explanations require --verbose; --cost still prints structural execution costs. CLI cases cover scoped, unscoped, decorated and legacy explicit-merge searches, each under plain/verbose/cost/residency output, including legacy incomplete/heap-null/no-next behavior. The pre-fix CLI test fails on the missing verdict note count (`pre-fix-cli.log`). |
| Low: `.count` ordering | Intent planning resolves the count-view alias before index selection, only when no real group column owns `count`. An executed two-group query proves ordering by counts rather than alphabetic category; a real count-column case proves the opposite precedence. Alias and `.value` return identical data and meters. The test fails before the fix with undeclared column count (`pre-fix-lang.log`). |
| Two client expectations | Applied `../client-test-followup.patch` exactly: retain the accepted len spelling and request --verbose for detailed unread-range output. These are the only client package edits beyond the initial merge. |
| Grok Medium: bound repair caret points at the shared helper | The comment replacement now points at the viewer-query declaration, with its exact inclusive source line range. The reason retains the failed helper read, its location and caller chain. The regression uses `d.site` and the printed range to replace the declaration, then runs the complete job and an adjacent untouched query. It fails on the old helper caret (`grok-pre-fix-lang.log`). |
| Grok Low: failing check suppresses prediction summary | Both compiler and adoption refusal paths now use the same terse prediction overview as successful check; verbose retains the detailed summary. An independently invalid query plus the read-through upsert reproduces the missing reason before the fix (`grok-pre-fix-cli.log`). JSON remains machine-readable and unchanged. |
| Grok Low: grouped maintain summary only counts views | The text-only summary names each view, unbounded inherited sync, loss of offline coverage and the eligible mutations that would stop predicting. Full compiler-note JSON is unchanged. The two-view CLI regression fails before the fix (`grok-pre-fix-cli.log`). |
| Grok Low: positional row key mistaken for scalar id | The binder records source write sites where a row key was lowered through `.id`; rewrite advice is withheld for those sites. Scalar-ID advice remains available, including the frozen compatibility fixture. A complete insert image with `upsert reactions[row]` reproduces the invalid `id = row` advice before the fix and executes the original update after it (`grok-pre-fix-lang.log`). |

The stability check also conservatively excludes bare table/view names, which
can lower to reads; a same-named lexical variable may therefore receive no
rewrite. This is advice withholding, not refusal of the original program.
Existing positive tests still execute stable-key/field rewrites through insert
and update. The runtime, authority, disclosure, bounds and meters are unchanged.

## Terse-note audit

Audited every coded note in the round-0 hidden search-certificate path:

| Code | Classification and default presentation |
| --- | --- |
| N_SEARCH_UNSCOPED | **Behavior, shown/counts:** no server completeness or safe continuation through hidden rows. |
| N_SEARCH_OPEN | **Behavior, shown/counts:** opening all memberships/heads must fit one read; an opening cut refuses E_SEARCH_OPEN without continuation. |
| N_SEARCH_WORDS | **Behavior, shown/counts:** expansion, misses and repeated refill work consume the meter. Legacy merges explicitly name incomplete/heap-null pages without next or E_SEARCH_OPEN. |
| N_SEARCH_SHAPE | **Behavior, shown/counts:** repeated per-hit roster reads consume the query-wide meter and can cut the shaped result. It is not treated as harmless formatting detail. |

No search note code is hidden. Only rewrites, long explanations and structural
cost detail are behind verbosity/explicit cost reporting. JSON retains the
existing full search objects: the text-only summary is excluded from serialization.
The CLI regression compares plain and verbose JSON after removing only elapsed
time. Verdict totals use compiler/adoption notes plus search notes; grouped
compiler notes retain their existing one-record count.

The ordinary compiler/adoption path has no code-specific hiding list. Its
existing concise summaries remain shown; grouped maintain summaries now also
retain view names and affected prediction consequences. Removed its blanket suppression during
measured --residency output as well. Audited codes on that path:

- Execution/prediction: N_EPHEMERAL_SERVER, N_HORIZON_GUARD,
  N_NOT_PREDICTABLE, N_NOW_SERVER.
- Completeness/continuation/coverage: N_HELD_UNKNOWN, N_NEVER_COMPLETE,
  N_NO_CURSOR, N_SYNC_ORDER, N_TIMELINE_PROFILE_CAP.
- Delivery/disclosure/result behavior: N_MAINTAINED_COLUMN_DISCLOSURE,
  N_MAINTAINED_COLUMN_STREAM, N_MAINTAIN_DELTA, N_MAINTAIN_SYNCED,
  N_NO_HORIZON, N_PUBLIC_AGGREGATE_COPY, N_SEQUENCE_READ,
  N_TIMELINE_ADOPT, N_TIMELINE_COMPAT.
- Work that can affect metered completion: N_OPTIONAL_FILTER_LIMIT,
  N_SPARSE_FILTER, N_WIDE_MERGE.
- N_SEEK is spelling/planning detail, already visible before this round; its
  existing concise line remains visible. Its rewrite/explanation remains detail.

LLP 3000.007 §23 and the prediction, search and maintains cards describe the
corrected behavior. The language-card alias sentence is shorter to accommodate
the LV-revert/AG guide composition within the unchanged word budget. No compiled
example or guide fact was removed; historical lowering digests stay unchanged.

## Verification

Before the late Grok corrections:

- Language: 10 first-paste regressions, 98 whole-guide tests, 11 lowering
  comparisons, 14 maintains tests, 41 residency-note tests and one frozen
  ephemeral-compatibility test passed (`affected-lang-guide-final-pass.log`).
- Device: both memory/SQLite first-paste witnesses passed (`affected-device.log`).
- CLI: 80 check, 10 cost, 3 notes, 27 fix and 28 scale tests passed
  (`affected-cli-final.log`).
- `./ref-check --verbose`: 523 LLP docs, 9,860 refs, zero errors or unchecked
  references (`ref-check.log`).
- Source diff whitespace check passes. No new diagnostic code, root registry
  or tracked generated artifact changed, so no Snapback 1 inventory regeneration
  is in scope.
- Toolchain: Rust 1.97.0 (2d8144b78), Node 24.13.1, Bun 1.3.14.

After the Grok corrections:

- Language: **10 audience/bounds, 1 frozen compatibility, 11 first-paste,
  98 whole-guide, 11 lowering and 41 residency-note tests passed**
  (`grok-affected-lang.log`).
- CLI: **81 check, 10 cost, 3 notes, 27 fix and 28 scale tests passed**
  (`grok-affected-cli-pass.log`).
- Device: **2 passed**, memory and SQLite (`grok-affected-device.log`).
- Authorized client expectation tests: **2 passed** against the final binary
  (`client-expectations-final.log`), with actual repaired-query execution.
- Final ref-check: **523 LLP docs, 9,862 refs, zero errors or unchecked**
  (`ref-check-final.log`).

The full-suite invocation started before these corrections; its Rust executable
inventory does not include their new tests. The later checks qualify the final
compiler/CLI/guide delta. No second full run is claimed.

Fresh canonical wasm: **2,040,529 B raw / 592,975 B gzip**, cap **593,719 B**,
**744 B headroom**, SHA-256
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
Built by the single full suite; see `wasm.json`. The later corrections touch
compiler/CLI/guide source, not wasm build inputs.

Ran `scripts/test.sh` **once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1428 s
```

Every script stage passed. The client stage totals **4,561 passed / 10 skipped /
0 failed** across its eight processes; the final model stage is **79/79**.
Full-suite failures by attribution: **ours 0, baseline 0, environmental 0**.
The 60-second suite target remains missed; no timeout or ceiling was changed.
The full log is `full-suite.log`; this is not a claim that it reran the late Grok
Rust tests. Their final affected checks and whole-guide run are listed above.

Rechecked both review files before finalizing; Grok's complete verdict/findings
are unchanged from the copy addressed here. `reviews.json` records their hashes
and the final check time. All Astra and Grok findings are addressed. One dated
journal entry accompanies the local fix commit, with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. No push or publication.

Captured log whitespace is normalized only at line ends and EOF; outcomes and
the exact suite summary are preserved. All regression-control and local
development failures are already attributed in [FAILURES.md](./FAILURES.md).
