# Lane EQ round 1 — conservative selected-index normalization

Date: 2026-09-28. Branch: `sb4-intent/eq-equality-prefix`. Round-0 commit:
`f4b841891baf0b6ca86261e14fba8b8f1ad39b95`. First fetched origin and merged
origin/main: already up to date, no conflicts. Read the binding prompt,
round-0 report/journal and complete Astra NOT READY review. Grok had no
verdict at startup and was not awaited. Nothing pushed or published.

All five requested findings are addressed. Final focused checks and the
repeated process/wasm/React history witnesses pass. The single full suite
reported one introduced positional-decoder failure; that correction has its
own passing affected checks, recorded below. Full §7.1 remains unqualified because
native Expo is unavailable on this Linux host. There is no xcrun, documented
machine-fleet file, or callable Fleet/SSH tool in this session. Process and
React are not substituted for Expo.

## Changes and regression evidence

1. **Earlier refusals:** extract only a leading conjunct. Never move an
   equality past any residual predicate, even an apparently infallible one.
   The new test preserves `BAD_ROW` from `checked(.denom)` and `E_DIV_ZERO`
   from `10 / .denom > 0`, with both argument and literal equalities.
2. **Full-prefix scans and result kind:** keep the final index component
   residual. Single-column ordinary indexes, fully constrained composite
   indexes and paged unique indexes retain valid array scans. Unpaged reads
   remain entirely unchanged, preserving their admission failures and result
   kind, including a unique scan with another predicate. Tests execute these
   shapes and check the result arrays and prefix lengths.
3. **Authored seeks:** reads with a seek take their existing binding path.
   A valid seek already targets the first unpinned component, so extending
   the prefix cannot preserve that relation. This also avoids making an
   originally invalid `second >= 0` seek valid by extracting `key = k`.
   Tests cover matching and contradicting bounds, pre-existing prefixes,
   literals and the original compile refusal.
4. **Old cursors:** only normalized pages carry `Scan.cursor_pins`, the
   number of extracted components. Its zero/default is omitted in serialized
   IR, preserving every old unmarked plan's strict validation. The runtime
   accepts either the new descriptor/current scope, or that exact old typed
   suffix/original scope. Table, index, order, generation, variant, canonical
   encoding and evaluated original prefix still must match. In-scope old
   positions lose the pinned leading values; new tokens use the suffix.
   Baseline cuts can point to visible filter rejects: a position before the
   new scope starts at its beginning, and one past it produces an empty scan,
   in either direction. Inclusive positions keep their meaning.
5. **Literal strength:** paired literal/bracket plans and results now check
   extraction in both operand orders and both scan directions. The residual
   reads the pinned column. Literal versions also accompany the refusal,
   full-index, seek and baseline-cursor cases. The review's literal-rejection
   mutation fails the new literal test.

The selected-index optimization is limited to explicit pages on plain indexes;
unpaged reads, word indexes, computed indexes, optional/fallible values,
conflicts, gaps, nonleading predicates and authored seeks stay on their
original paths. It does not alter authorization, expiry, disclosure or meter
rules, schemas, package versions, or the wasm budget.

Cursor compatibility requires a small runtime change and one defaulted IR
field. Other Scan/ReadExpr construction-site edits only initialize its empty
value. Cursor descriptor validation is shared, and repeated decoding/typed
validation is removed without changing the checks or their order. That
reduction keeps the feature under the existing wasm budget. Merge/word cursors
do not gain legacy-prefix conversion.

`selected-prefix-cursors.json` stores 24 actual engine-minted baseline tokens:
first/last × existing/no prefix × argument/literal × full page/cut before/cut
past. The baseline compiler control restores the pre-EQ selected-index early
return. The generator asserts its old prefix length, so it cannot silently
mint normalized cursors. The normal test never rewrites the fixture. It
continues every token, traverses the whole matching group without skips or
duplicates, checks inclusive positions, and rejects invalid descriptor/scope
controls and conversion on an unmarked plan. Fixture provenance and the mint
command are documented beside the JSON.

The original builder still compiles; its schema and surviving executable
fields match the bracket fixture. The sole intentional IR difference is the
equality page's legacy-cursor metadata. Both forms select the same byHistory
prefix. `historyHeld` and the archived query selector remain removed from the
separate equality fixture; P19's immutable original remains untouched.

## Repeated §7.1 witnesses

All four cases passed, zero failures or skips:

- `history-final.log`: ordinal and timestamp variants, each with process and wasm
  devices, empty and 10,000-message groups, exact 500-row full-key floor,
  timestamp ties, below-floor incompleteness, publication holds, departure,
  residual/order preservation, remount, offline reopen and rejoin.
- `calibration-final.log`: private copy of the complete calibration SQLite/WAL/assets,
  using the original membership mutations and existing 10,000-message group.
- `browser-final.log`: Chromium/IndexedDB and the copied receipt hook, delayed
  route/progress reads, stable composer identity/focus/draft, retained IDs,
  remount, offline reload and rejoin.

The final committed compressed JSONL files contain **462 paired observations**
(154 per ordinal, timestamp and calibration arm), plus publication watches
and the two React snapshot collections. `evidence-final.json` records hashes
and counts for `history-final-*.jsonl.gz`. `evidence-final-audit.log` verifies
all pairs, including exact next-cursor bytes and raw coverage, independently
of the witness assertions. The initial round-1 witness payloads and manifest
also remain archived. Both runs pass; the final run used the rebuilt artifacts
after the positional-decoder correction. Acquired exact-floor pages remain complete, below-floor history remains
incomplete, departure keeps authorized retained rows without server fallback,
and rejoin restores current authority. Media denial and `NOT_MEMBER` progress
remain separate from ordinary retained history. No history loss/duplication
occurred. All immutable-input checks passed, including SQLite and WAL hashes
after the final rerun (`input-integrity-post-suite.log`).

Native Expo is the remaining environmental qualification gap, unchanged from
round 0. No claim of all §7.1, the rest of the RFC, or a new calibration score.

## Checks

- Final affected compiler/diagnostic/cursor checks: **62 passed**; whole guide:
  **92 passed** (`affected-final-exact.log`). This includes 12 EQ tests across
  the three selected-prefix files. Builder normalization is asserted directly.
- Core affected corpus/disclosure/meter targets: **58 passed** (18 + 32 + 8).
  Device codec: **11 passed**. Final workspace build, client build, docs budget
  and original-input integrity passed.
- Full suite ran **once**, after the review fixes and initial paired witnesses.
  Exact summary from `full-suite.log`:

  ```text
  == 1 failure(s) in 1856 s
     cargo test
  ```

  The only failed test was **ours**, the old positional Scan decoder described
  below. No baseline or environmental test failures. All other stages passed:
  workspace build, wasm/budget, docs budget, release guard, package build and
  typecheck, both app typechecks, 9 fixture tests, **3,901 client tests** (10
  existing skips) and **79 client models** with full seed counts. The suite
  retains its original red; it is not a claim that the corrected final tree
  received a second green full-suite run. Command:
  `SNAPBACK4_RUST_TEST_PROCESSES=8 taskset -c 64-79 bash scripts/test.sh`.
  Node 24.13.1; Cargo jobs 8, Rust test threads 8, debug information and
  incremental compilation off, packaged SQLite flags, fd limit 65,536.
  CPU affinity limits Node's available concurrency to 16; no test selection,
  model seed count, timeout or meter ceiling was reduced.
- After the positional correction: all 10 lane-source tests, all 12 EQ tests
  and the 92-test whole guide pass. The final guide wording and workspace build
  also pass (`guide-final.log`, `build-guide-final.log`). The final reference
  audit is recorded in `ref-check-final.log`.

## Failure ledger

**Ours, deliberate reproductions/mutations:**

- `regressions-before-fixed-harness.log`: round 0 fails three new tests
  (earlier refusal, full-index scan, existing seek); literal pairing passes.
- `cursors-before.log`: round 0 rejects an actual baseline-minted continuation
  with `E_INPUT` / different table, index, order or suffix.
- `literal-mutation.log`: rejecting every literal candidate fails the added
  literal pairing test. Mutation restored before final checks.
- `round0-regressions.log`: final regression set against the exact round-0
  intent planner has five failures: the three above, originally invalid seek,
  and unpaged-domain preservation. Literal pairing passes. Planner restored;
  all six tests pass on the final implementation.

**Ours, development mistakes, all corrected:**

- `regressions-before.log`: used `Refusal.code()` instead of its `code` field;
  test compilation failed before any test ran.
- `mint-baseline.log`: fixture output path assumed workspace cwd; Cargo runs
  this test in the crate directory. Corrected mint passes; cut mint also passes.
- `fixes-first.log`: one synthesized ReadExpr constructor lacked the new
  defaulted metadata field. Added the default; focused tests pass.
- `affected-guide.log`: named nonexistent abbreviated Cargo targets. Correct
  target names are used in the succeeding affected/guide runs.
- Full-suite `snapback4-core::lane_source`,
  `typed_errors_keep_text_positions_and_nested_sources_use_the_same_decoder`:
  placing the new defaulted Scan field first broke its old positional sequence
  form (`invalid type: string "s", expected u32`). Moved the field to the end;
  all 10 lane-source tests pass in `lane-source-corrected.log`. The original
  full-suite failure is retained; it is not represented as a green rerun.
- Initial wasm implementations exceeded the unchanged budget by 672, 495,
  413, 74, 139 and 159 B (`wasm-after-first` through `sixth`). The final
  shared-validation implementation passes with 60 B headroom; none of the
  failed artifacts is the qualified final artifact.
- Two setup shell invocations sourced `.work/eq-env.sh` from the repository
  root instead of snapback4. Corrected before the actual test commands.
  Exploratory reads also named a few nonexistent paths and were corrected;
  none changed source or supplied a qualification result.

**Baseline test failures: zero. Environmental test failures: zero.**
The 10 existing client skips are: macOS Foundation/AVFoundation media (1),
managed organization/invitation pinned binary/private scratch (1), managed
OIDC private scratch (1), published 0.2.27 bounds binary (1), published 0.2.33
F2 binary (1), published capability-fence/control tarball cache (4), and
published 0.2.32 sync-wire binary (1). Exact names/reasons are in `full-suite.log`.
No final affected test or EQ witness failed. The unavailable native Expo
witness is an unrun qualification, not a passed/skipped native test.

## Wasm and tools

Same Rust 1.97.0 / wasm-bindgen 0.2.127, official build script, no selected
wasm-opt artifact:

| Artifact | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Rebuilt round-0 baseline | 2,019,815 | 585,384 |
| Final runtime cursor fix | 2,020,387 | 586,133 |
| Growth | **572** | **749** |

Unchanged budget **586,193 B**, headroom **60 B**. Growth is the whole-artifact
cost of scoped legacy cursor handling and its IR metadata, offset by shared
validation and removal of redundant decoding; not per-component attribution.
`wasm.json` and SHA-256 logs identify both artifacts. The positional-field
correction was first measured in an isolated output
directory while the suite used stable artifacts. The final official public
artifact rebuild is byte-identical to that measurement (`wasm-final.log`,
SHA-256 `4f97bd8c5edc0100398cda8df1993221264861def35f2b47fb2f8fe5f5efbc3a`).

Binaryen 132.0.0 was installed only in `snapback4/.work/wasm-tools`, with npm's
cache also under `.work`. Its `-Os` baseline trial was 1,854,702 B raw but
669,272 B gzip under the trial filename, worse than the unoptimized baseline;
it was not selected or put on shared PATH. No shared tool path was changed.
No budget, dependency manifest, version or publication change.
