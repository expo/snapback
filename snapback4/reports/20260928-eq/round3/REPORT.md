# Lane EQ round 3 — composite shape and disjunction regressions

Date: 2026-09-28. Branch: `sb4-intent/eq-equality-prefix`. Base:
`361ca4ceaf9fc3ec37bcad83c51f345ddbbeed22` (round 2). Read rounds 0–2's
prompts, reports and EQ journal entries, Astra's full round-2 READY WITH
CHANGES review, and the preceding Astra/Grok reviews including Grok round 1.

This round changes two Rust test files, two test fixtures, EQ reports and
the explicitly requested appended journal entry. Product source and LLPs
are unchanged. Fetched origin; main had seven commits absent from this lane at
`5763da0734164738dbb4a05b0fd4fb9eea4cb5b3`. The new test-only instruction
supersedes the earlier fetch-and-merge instruction: no merge changes the
round-2 source while the supervisor's landing suite is running.

## Regressions and controls

**Composite unfinished shape.** The existing helper now supports either one
or two extracted columns, retaining the existing first/last single-column
tests. Two additional tests use exactly `(lane, bucket, id)`,
`.lane = 0 and .bucket = 7`, one item and a returned shape counting 9,000
details. The default 8,192-row ceiling is unchanged. Each checks both the
baseline-minted inclusive full-key cursor and a freshly engine-minted
normalized cursor, requiring `E_SHAPE_EXCEEDS_METER` on their first follow.
The saved token has empty prefix, values `[0, 7, id]` and suffix
`[lane, bucket, id]`; the new token has prefix `[0, 7]` and suffix `[id]`.

The fixtures are engine-minted, never fabricated. In a private source copy,
the generator removes only the selected-index call to `selected_prefix`,
restoring the pre-EQ compiler path. Minting asserts zero extracted columns,
checks that the returned cursor is inclusive, and verifies the baseline's
first follow already refuses before saving the token. The mint command
passes both tests; the restored compiler then passes all 17 EQ tests.
`mint-baseline.patch.gz`, `mint-baseline.log.gz` and `fixtures.json` retain the
exact change, results and fixture hashes.

`mutation-one-column-shape.patch.gz` wraps only the shape-token descriptor,
scope and re-encoding normalization in `if removed == 1`; scan-position
conversion remains unchanged. Across all 17 EQ tests, **15 pass and exactly
the two composite tests fail**. Both first follows return `Ok` with empty
data, `complete: false`, `cut: Some(Meter)` and another cursor, rather than
the required refusal. Thus all 14 prior EQ tests still pass this mutation,
while both new direction tests catch it. Full output is retained in
`mutation-one-column-shape.log.gz`.

**Disjunction.** `disjunction_stays_residual_and_returns_rows_from_both_arms`
executes `.key = k or .second = 0` with `k = 1` on public rows with
`(key, second)` values `(0, 0)`, `(1, 1)` and `(2, 2)`. It requires exactly
`r0, r1` for `first`, `r1, r0` for `last`, complete answers and an empty
prefix. Each returned row satisfies only one disjunct; the third satisfies
neither. The exact answer is asserted before the prefix, so the mutation
fails on behavior rather than only a planner representation.

`mutation-split-or.patch.gz` changes `split` to recurse through both `and` and
`or`. The new test fails: expected `[r0, r1]`, received `[]`. Splitting the
disjunction incorrectly requires both pins and loses both rows in this
fixture. `mutation-split-or.log.gz` records **0 passed / 1 failed**.

All mutations and baseline compilation occur under the worktree's ignored
`.work/round3-controls/`. Both copied source files are restored in `finally`;
the lane source files were never edited. Their hashes are in `inputs.json`.
The corrected `controls.py` uses separate Cargo target directories for the
private copy and lane, and refuses to overwrite an existing scratch copy.
On a fresh scratch path, reproduce from the repository root with:

```sh
ulimit -n 65536
python3 snapback4/reports/20260928-eq/round3/controls.py
```

## Qualification

`tests.json` records every Cargo command, working directory, exit status,
duration, exact summary lines and SHA-256 of each uncompressed log. Logs are
compressed without text edits. Rust/Cargo 1.97.0; eight build jobs and test
threads; incremental compilation and debug information disabled; packaged
SQLite flags; fd limit 65,536. Every test command uses `--no-fail-fast`.

Final requested checks:

| Check | Passed | Failed | Ignored |
| --- | ---: | ---: | ---: |
| EQ: selected_prefix / selected_prefix_cursors / selected_prefix_regressions | 17 (5 + 5 + 7) | 0 | 0 |
| Whole guide | 92 | 0 | 0 |
| Server continuation/shape (`clique`, `merge_continuation` filter) | 67 | 0 | 0 |
| Device continuation/shape (`device`, `merge_continuation` filter) | 134 | 0 | 0 |

Total: **310 passed, zero failed or ignored** in the final corrected checks.
Module filters leave unrelated tests unrun. Reference audit passes. Final
whitespace, evidence hashes, source scope and append-only journal checks are
recorded in `audit.json`.

`scripts/test.sh` was **not run**, as instructed. The supervisor owns the
landing suite. Round 1's historical full-suite summary is unchanged:

```text
== 1 failure(s) in 1856 s
   cargo test
```

That historical failure was the subsequently corrected lane-owned positional
Scan decoder. This round adds no full-suite, history/browser/Expo or broader
RFC qualification claim; the historical native Expo gap remains unrun.

## Every failure and its attribution

- **Ours, intentional shape mutation:** two composite tests fail at the
  first-follow refusal, with the exact extra empty page described above.
  The other 15 EQ tests pass. Mutation restored.
- **Ours, intentional `or` mutation:** one test fails on missing returned
  IDs. Mutation restored.
- **Ours, report-script parser:** after successfully collecting both shape
  failures, an output-text assertion assumed `data` and `complete` were
  adjacent in Rust's debug output; `unavailable: false` lies between them.
  The script exited 1 and its `finally` restored the private source. The
  report-only parser now checks each required field on each failure line,
  including `next`. The preserved log validates; tests were not changed or
  repeated to correct this parser. `control-parser-initial.txt` retains the
  error and explanation. Execution resumed with the `or` control.
- **Ours, shared Cargo artifact isolation:** the initial harness incorrectly
  shared one Cargo target between the copied mutant sources and the lane.
  The first lane invocation reused the last mutant build and exited 101:
  EQ **16 passed / 1 failed**, guide **90 passed / 2 failed**. Failures:
  `disjunction_stays_residual_and_returns_rows_from_both_arms`,
  `every_card_compiles_clean`, and
  `feeds::followups::published_global_filters_originals_and_preserves_independent_reposts`.
  Each observed the empty answer caused by splitting `or`.
  Qualification stopped at that invocation. Both source hashes matched
  round 2 and the restored private copy; no source or test change followed.
  Separate target directories now isolate the builds. Cleaning only the
  three affected package artifacts (`snapback4-core`, `snapback4-lang`,
  `snapback4-device`) and rebuilding the identical lane source/tests gives
  **17 EQ + 92 guide passed**. The initial red is preserved as
  `shared-target-eq-guide-initial.log.gz`; the cleanup and corrected run
  have separate logs. `shared-target-diagnosis.json` records the source hashes.
- **Ours, exploratory inspection:** a read named nonexistent
  `selected_prefix_safety.rs` (the file is `selected_prefix_regressions.rs`);
  a scoped AGENTS search returned no matches; an `ls` assumed the removed
  `snapback4/target` cache existed. Corrected inspection/build setup; no
  source edit and no test result from these probes.

**Baseline test failures: zero. Environmental test failures: zero.**
The build-cache contamination was caused by this round's harness and is
classified as ours, not attributed to the baseline or external environment.
The unmutated new tests pass without any product-source correction.

## Wasm, orientation and limits

Remeasured the existing round-2 artifact without rebuilding:
**2,020,770 B raw / 586,142 B GNU file-input gzip-9**, delta **0 / 0**.
Unchanged cap **586,193 B**; **51 B** headroom. SHA-256:
`8d88256858e583b936a5aa0bf1ee170aa94d252afe4d1369f16c0c460b55557b`.
`wasm.json` records the measurement. No tool installation or package/budget
change. Nothing pushed or published. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

Applied `llp-orient` read-only from
`/home/ccheever/projects/snapback/vendor/llp/skills/llp-orient/SKILL.md`.
Scope: the two selected-prefix test files and their existing `@ref`s.
Governing constraints: LLP 3000 §2/§7 (one interpreter and typed outcomes),
LLP 2000.000 §6 (unchanged meters), LLP 3000.028 §3.2/§7.1/§7.6 (safe
normalization, residual predicates and cursor/refusal compatibility), and
LLP 3000.007 §14 ruling 35 (immediate no-progress shape refusal). Read the
current reads card. Both existing file references still apply. No new design
decision or corpus edit is needed; the current instruction confines this
round to tests, reports and one journal append. Hand-off: none for LLP;
the supervisor owns integration and wider qualification.
