# P5: an unread count the device can certify

Implementation of LLP 3000.020 revision 1 on `sb4-intent/p5-unread-range`,
based on `992cec75c`. The RFC remains Draft for the supervisor's design review.
No push or publication.

## Changes, file by file

- `llp/3000.020-an-unread-count-the-device-can-certify.rfc.md`: supplied revision 1.
- `llp/current/3000.020-an-unread-count-the-device-can-certify.rfc.md`: relative working-set link.
- `crates/snapback4-core/src/maintain.rs`: shares the ordinary and row-keyed predicate evaluator without changing ordering, short circuits or metering, to keep the device inside its wasm budget.
- `crates/snapback4-core/src/maintain/row_key.rs`: adds the horizon-column lower-bound selector, normalization, strongest-bound selection and null fallback; preserves the legacy `live_range` helper. Bound selection and key prefixes borrow their existing values rather than allocating lists or copies. Uses existing comparison indexes; no schema or index-definition change.
- `crates/snapback4-core/src/engine/row_views/device.rs`: device range planning, current-row partial counts, horizon unknown facts and prediction deferral.
- `crates/snapback4-core/src/engine/row_views.rs`: current group authority separate from completeness; same-parent acquired-floor proof; authorized, live, current/provisional contributions; sequence-selection dependencies even for empty ranges; shared read/prediction plan. Server certification, accounting and durable recount cursors retain their existing paths.
- `crates/snapback4-lang/src/bind/maintains.rs`: admits optional source/member scalar comparisons using the already-defined total ordering. Incompatible scalar types still fail.
- `crates/snapback4/src/scale.rs`: distinguishes expiring row-keyed reads, pure existence witnesses, ordinary aggregates and non-expiring stored values; records the unmetered server walk as `grows` without charging an invented examined-ceiling traversal.
- `crates/snapback4/src/scale/writes.rs`: labels unique/existence checks as witnesses.
- `crates/snapback4/src/verbs.rs`: range column, normalized operators, member fields, index, horizon and null fallback in `check` text/JSON.
- `crates/snapback4-lang/src/guide/maintains.md`: complete compiling Clique example with sequence, private membership, sync window, conversation timer and expiry; exact, lower-bound, optimistic and server semantics.
- `crates/snapback4-lang/src/guide.rs` and `guide/why/E_QUARRY_MAINTAIN_EXPIRE.md`: ordinary aggregate meter cuts are null; expiring row-keyed range cuts retain the pending partial.
- `crates/snapback4-device/tests/unread_range/schema.q` and `cases.json`: shared fixture and 39 scenarios.
- `crates/snapback4-device/tests/unread_range.rs`: runs those scenarios on memory and SQLite, including cold reopen, plus two real guide-program tests.
- `crates/snapback4-device/tests/readauth/census.txt`: registers the guide send's conversation read, message insertion and maintained-view rule evaluation.
- `crates/snapback4-device/tests/row_keyed_views.rs`: updates the former public-global-window prediction expectation; that floor cannot prove a parent's range.
- `crates/snapback4/tests/scale_row_ranges.rs`: certificate classes/sentences, the distinction between expression `exists` and a pure rule witness, count-dependent rule refusal and optional-operand compatibility.
- `packages/snapback4/test/unread-range.test.mjs`: the same 39 scenarios on wasm, actual client fallback/offline behavior, meter-cut no-fallback, guide runtime and CLI output.
- `packages/snapback4/test/row-keyed-view.test.mjs`: existing JSON output expectation includes `range: null`.
- `JOURNAL.md`: one appended dated implementation/measurement entry.
- This report: review evidence and implementation decisions.

## Forms and results

The complete example is in `guide maintains`; these are the independently
exercised predicate forms within its row-keyed view:

| Form | Example | Device behavior |
|---|---|---|
| Strict lower bound | `.ordinal > m.readUpTo` | Exact when the saved parent floor proves the range. |
| Inclusive lower bound | `.ordinal >= m.readUpTo` | Includes ties; stays pending if a smaller id at the floor ordinal is unheld. |
| Reversed comparison | `m.readUpTo < .ordinal` | Normalizes to the strict lower bound. |
| Several bounds | `.ordinal > m.readUpTo and .ordinal >= m.joinedAt` | Greatest value wins; strict wins an equal-value tie. |
| Optional watermark | `readUpTo: int ?` | A null candidate disables range selection for that read; whole-group rule and ordinary null ordering apply. |
| Upper bound | `.ordinal < m.readUpTo` | Compiles, but has no suffix range; requires the whole group. |
| Real Clique source | `ordinal: sequence by conversationId`, `sync to members[.conversationId] last 500 by .ordinal`, `expire at .expiresAt` | 503 actual sends, mark 501: exact 2 after cold reopen, then exact 0 at expiry. |
| Pure rule witness | `read <- exists unread[member = .member]` | Indexed existence/lifetime witness; certificate `constant`, no count certification. |
| Expression existence | `return exists unread[member = member]` | Existing read-through semantics certify the count; certificate `grows` for an expiring source. |

An uncovered range with six unread server rows and only the newest three held
returns `3`, pending/incomplete, with an unknown fact. The real online client
returns the server's exact `6`; a cold offline reopen retains `3`. A covered
8300-row scan cut by the meter returns a positive partial and sends no server
query. A non-expiring pending count retains its last settled `42` after a mark.

## Tests and decisions

The shared scenarios cover exclusive/inclusive floor ties, strongest/reversed/
null/upper comparisons, incorrect and composite horizon orders, public-parent
mismatch, empty Whole, missing/interrupted acquisition, own sends, tombstones,
physical deletion, expiry and floor-row expiry/deletion, later backdated rows,
backward marks, covered/uncovered/empty predictions, retained leave/rejoin,
short ranges in large groups, provisional sequence dependencies and lost
current source authority. Every scenario runs before and after reopen on
memory, SQLite and wasm. Exact initial cases are compared with the server.

The guide runs through the real mutation's sequence and conversation timer on
all three device configurations. The client tests exercise the existing
`local-query.ts` fallback; no production TypeScript/client contract change was
needed. The certificate tests cover range/no-range/non-expiring/witness classes;
CLI tests inspect text and JSON. Existing server accounting/disclosure/witness/
legacy tests verify preservation of the server behavior.

Engineering decisions where the brief was silent:

- Optional cross-row scalar operands needed a narrow binder relaxation; runtime
  predicates already had the specified ordering. Other maintain comparisons
  keep their existing restrictions.
- The guide's membership keys are immutable, as required by its synced
  membership rule. Timer values are milliseconds in the existing `time + int`
  arithmetic.
- Composite-order tests use the existing explicit named-index spelling; this
  lane does not depend on P1's new authoring form.
- Correcting the parent-prefix proof also corrects one old non-expiring device
  prediction test that treated a public table's window as a parent's window.
- Current authority is evaluated from the admitted parent-only source rule and
  current witnesses. Retained membership or lost source authority cannot
  certify a count. Current/provisional source checks happen before contribution.
- The constant witness sentence applies to rule probes. Expression `exists` currently goes through the full row read, so its certificate stays `grows` over an expiring source. The server implementation is unchanged.
- Source-prefix borrowing and the shared predicate/comparison walkers reduce wasm size without changing index definitions, predicate ordering or the meter. Coverage rejects resumed bounds; every existing coverage caller supplies a fresh predicate bound. Durable recount cursors are unchanged.
- No new diagnostics, index, migration, budget increase or server-accounting
  change. No revision-1 design change was necessary.

## Mutation checks

Every mutation below produced `test result: FAILED. 0 passed; 1 failed;` in
`unread_range::native_memory_scenarios`, and was restored immediately afterward.
The scenario filter is `SNAPBACK4_UNREAD_CASE=<case>`; it never changes the
unfiltered suite inventory.

| Mutation | Failing scenario |
|---|---|
| Ignore the range and scan the whole group | `short-range-large-whole` |
| Ignore the acquired floor | `below-floor` |
| Ignore the acquired parent prefix | `public-parent-mismatch` |
| Treat inclusive `>=` as strict `>` | `inclusive-above-floor` |
| Count retained history | `retained-rejoin` |
| Publish zero for an uncovered pending count | `below-floor` |
| Omit the range's unknown fact | `below-floor` |
| Treat an upper bound as a suffix range | `upper-bound` |

## Measurements and final verification

The baseline and final builds used Rust 1.97.0, the repository's wasm profile,
`wasm-bindgen`, and `scripts/build-wasm.sh`, with no `wasm-opt` available.

| Build | Raw wasm | gzip -9 |
|---|---:|---:|
| `992cec75c` baseline | 2,021,689 B | 581,094 B |
| Final lane | 2,024,421 B | 581,517 B |
| Change | +2,732 B | +423 B |

Budget: **582,094 B**; remaining **577 B**. No budget/toolchain/profile changes.
`bun run build` passes.

One complete run, with `CARGO_BUILD_JOBS=8`,
`SNAPBACK4_RUST_TEST_PROCESSES=12`, and
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`, exited 1. Its exact summary is:

```text
== 3 failure(s) in 3270 s
   wasm build
   cargo test
   client tests
```

Every failure and its classification:

1. **Ours, fixed:** the first wasm build was 582,210 B gzip, 116 B over the
   unchanged budget. Borrowed range values/key prefixes and shared comparison
   traversal reduce the final build to 581,517 B; `scripts/build-wasm.sh` passes.
2. **Ours, fixed:** `snapback4-device::readauth::census::authoring_census` found
   three new guide send sites absent from `census.txt`. After reviewing and
   registering those sites, its isolated rerun passes (1 test).
3. **Environmental startup failures:** `legacy-receipts.test.mjs`'s memory
   “legacy old-page with empty history replays NOT_ADMIN without executing” and
   “legacy old-page with replacement history replays NOT_ADMIN without
   executing” both failed in `witness/lib.mjs:84` with
   `Error: dev readiness timed out`, at 5.337 s and 5.060 s. The same two cases
   pass isolated (2/2, 6.74 s total). No persistent baseline failure is claimed.

The complete run's client summary was 2,267 tests: 2,255 passed, 2 failed,
10 skipped. Its client-model stage passed. All other stages passed apart from
those listed above; the complete guide was 86/86. The existing server
accounting (6), disclosure (18), legacy (1) and witness (3) cases passed.
The existing device disclosure tests passed, including its 6 row-view cases.

Final affected-scope reruns all pass:

| Command (from `snapback4/`) | Result |
|---|---|
| `cargo test -p snapback4-device --test unread_range --test row_keyed_views --test row_view_expiry` | 4 + 23 + 10 passed; the 4 new functions run 39 scenarios on each native store plus the two guide executions. |
| `cargo test -p snapback4 --test scale_row_ranges --test scale --test scale_windows_expiry --test check` | 3 + 20 + 7 + 71 passed. |
| `cargo test -p snapback4-core --test row_view_accounting --test row_view_legacy --test row_view_witness` | 6 + 1 + 3 passed. |
| `cargo test -p snapback4-lang --test guide` | 86 passed, no diagnostics/notes in guide examples. |
| `cargo test -p snapback4-device --test readauth census::authoring_census -- --exact` | 1 passed. |
| `node --test --test-concurrency=1 packages/snapback4/test/unread-range.test.mjs packages/snapback4/test/row-keyed-view.test.mjs` | 43 passed, 0 failed, 0 skipped; 20.743 s. |
| The eight mutants in the table above, followed by restored native tests | 8/8 killed. |
| `cargo build -p snapback4` and `bun run build` in `packages/snapback4` | Passed. |

Root `./ref-check --verbose` passes exactly:

```text
ref-check: ok — 514 LLP docs, 9447 refs in 26810 files, 0 errors, 0 unchecked
```

`git diff --check` passes. Every modified source file remains below 1,500
lines (largest: `verbs.rs`, 1,071). The journal's original contents are unchanged;
exactly one dated entry is appended.

## Open problems and reproductions

No known unresolved implementation failure. The complete suite has not been
rerun after the owned fixes; its recorded result remains the failure above.
To retry the environmental cases:

```sh
node --test --test-name-pattern='memory: legacy old-page' packages/snapback4/test/legacy-receipts.test.mjs
```

A repeat under shared-host load may reproduce the five-second dev startup
limit; the isolated command passes. This lane does not change that harness.

The design's intentional exclusions remain: a server count for a never-opened
100,000-message conversation still walks its whole live basis internally;
and a remembered server answer containing expiring rows can still be
withdrawn as a whole when one expires offline (the existing remembered-answer
expiry ticket). This lane changes neither server accounting nor remembered
answer lifetimes.

## Round 1 — 2026-09-26: revision 2

This section supersedes round 0's range-first `Whole` behavior and its
any-null-disables-selection rule. Both revision-1 reviews and the supervisor's
revision-2 draft were read in full. The RFC now contains revision 2 verbatim,
including its Revised history. No correction to the revision-2 design was
necessary. The server's policy, private allowance, durable cursor format,
indexes, publication version and wasm budget are unchanged.

### Changes by requested item and file

1. **Whole:** `engine/row_views/device.rs` checks whole-group coverage first and
   preserves `live_basis_scan`. The 9,000-expired/3-live case certifies 3 after
   offline expiry. The old large-Whole short-range test now uses a windowed
   group; the range path extends coverage beyond Whole. A Whole meter cut
   retains the historical zero/pending result.
2. **Candidate path:** round 0's authorized candidate walker already skipped
   expired images, excluded retained-only copies and recorded contribution
   deadlines. Tests now explicitly assert `nextExpiry` on both exact and
   pending counts, then advance the offline clock without applying a deletion.
   `engine/row_views.rs` additionally enforces the static parent-pinned uniform
   source rule before counting. Unresolved authority remains uncertain.
3. **Sequence selection:** the existing pre-scan observation is retained. The
   shared tests now exercise successful count-dependent predictions as well as
   dependent refusals, with both nonempty and empty selected ranges.
4. **Prediction:** the range writer allows its final empty seek to prove
   completion at exactly 1,024 candidates. The 1,025-row range queues without
   a predicted result, as does uncovered input. Neither persists a lower
   bound. Existing fan-out and server-writer behavior is retained.
5. **Selector:** `maintain/row_key.rs` treats null as the weakest bound. A
   non-null sibling remains eligible; all-null operands use the whole-group
   rule. Other columns remain ineligible. Normalization, strictness at equal
   values, and greatest-bound selection remain shared with reporting.
6. **Flags/fences:** every shared read asserts that it is not speculative.
   Coverage misses are pending/incomplete with unknown; covered cuts carry
   their partial without unknown. All-null reads also keep no range unknown
   when source authority is lost. `row_views/range_tests.rs` verifies a
   pending numeric witness cannot succeed and checks the device/server
   `Cut::Abort` distinction. The actual wasm client retains `L` behind `held`
   and an unobserved predicted write; normal online fallback and offline
   persistence still work. No production TypeScript change was needed.
7. **Certificate:** `scale.rs` now prints the complete server reservation and
   traversal sentence and the device conditions, cut behavior, null fallback
   and expired-candidate cost, using actual columns/operators/member fields.
   Metadata-only witnesses remain constant; expression `exists` and numeric
   probes take the count path. Stored non-expiring values state that pending
   last-settled values are not lower bounds. No invented server backlog site
   or examined-ceiling traversal is added. `scale_row_ranges.rs` checks the
   guide program, renamed fields with `>=`, all four cases and the allowance.
8. **Check:** `verbs.rs` exposes every bound's column/operator/member field,
   index, horizon index, greatest encoded-bound selection (strict wins ties;
   null is weakest), and whole-group fallback in text and JSON; absence stays
   `null`. The wasm/CLI tests check both one and multiple candidates.
9. **Guide:** `guide/maintains.md` documents Whole, weakest null siblings and
   fallback fences. `guide.rs` and both expiry why cards state ordinary cuts
   are null and range cuts return `{ value: L, recountPending: true }` with
   `complete: false`. All generic server-cost paragraphs are qualified as
   ordinary aggregates. The stale sequence sentence was already removed in
   round 0. `guide-fact-homes.json` now quotes the corrected ordinary-aggregate
   sentence; the original assertion otherwise remains intact.
10. **Evidence:** `unread_range/cases.json` now has 48 scenarios, shared by
    `unread_range.rs` and `unread-range.test.mjs`, including cold reopen.
    `unread_range/counted.rs` wraps actual native store transactions to count
    fetched source candidates independently of receipts. `measured.rs` checks
    memory and SQLite, populated adoption, request-wide allowance, and the
    20,000-live/10,000-expired server comparison. The existing server
    disclosure tests are unchanged.

The core implementation shares the static authority proof using already
borrowed source metadata and reuses the source-index name. It also computes
expiry classification once per scan. These changes keep revision 2 within
budget without altering index definitions, cursor contents or meter charges.
All source files remain below 1,500 lines.

### Forms and measured behavior

- `.ordinal > m.readUpTo`: a window covering the encoded suffix certifies
  offline and after reopen; with 3 unread in 20,000 rows, exactly **3 source
  candidates** were fetched on each native store.
- `.ordinal >= m.readUpTo`: includes ties; an encoded bound below the full
  floor key stays pending. `m.readUpTo < .ordinal` retains normalized `>`.
- `.ordinal > m.readUpTo and .ordinal > m.joinedAt`: with `readUpTo = null`
  and `joinedAt = 4`, the covered fixture certifies 2. A null ordinal bound
  plus a bound on `.at` does not select that other column.
- Three reads of a 4,000-unread badge in one request publish
  `{ a: 4000, b: 4000, c: 168 }`: **8,168 source candidates total**, pending,
  incomplete, not unknown and not speculative. Both native stores and wasm
  produce that result.
- The server returns 3 for 20,000 live rows, identically with 0 or 10,000
  additional unswept expired rows. The full read receipt in both worlds is
  examined 3, probes 1, steps 13, heap 1,445 B, output 9 B. This includes the
  member/read overhead; the certification reservation remains one examined
  unit and one step. The count-dependent writer succeeds in both worlds.

### Scope decisions and deviations

No design deviation, new diagnostic, index, migration, server accounting
change, budget increase, push or publication. A non-uniform source is rejected
by admission; its defensive runtime behavior and the normally unspellable
expiring numeric rule probe are tested at the raw core boundary. The 48
admitted scenarios run through the actual device on all three configurations.
Storage-visit instrumentation runs on both native stores; the wasm device
runs the same large-range and shared-allowance cases and asserts the resulting
counts and flags. No instrumentation is added to the production wire.

The broader exclusions remain: the server's unmetered live-group walk and
remembered-answer expiry are outside this lane. `llp-orient` is a broken
project skill link in this checkout; no accessible copy was found. Orientation
used the governing RFC, reviews, baseline spec, guide and implementation
instead; no skill is claimed to have run.

### Wasm measurement

Pinned toolchain/profile, `scripts/build-wasm.sh`, no wasm-opt, unchanged
`metrics/wasm-budget.json`:

| Build | Raw wasm | gzip -9 |
|---|---:|---:|
| Original `992cec75c` baseline | 2,021,689 B | 581,094 B |
| Round 0 | 2,024,421 B | 581,517 B |
| Round 1 | 2,024,555 B | 582,024 B |
| Round-1 change from round 0 | +134 B | +507 B |
| Cumulative lane change | +2,866 B | +930 B |

The **582,094 B** budget has **70 B** remaining. Intermediate builds exceeded
it; borrowed authority metadata, source-index reuse and simpler Whole/range
control flow resolved the overrun without weakening the proof or raising a
ceiling. The final build gate passes.

### Round-1 mutants

All twelve were applied independently, compiled, and killed by the indicated
`native_memory_scenarios` case. Every mutant produced
`test result: FAILED. 0 passed; 1 failed;`; none was credited for a compiler
failure. Each change was restored before the next. Reproduce an individual
case with `SNAPBACK4_UNREAD_CASE=<case> cargo test -p snapback4-device --test
unread_range native_memory_scenarios -- --exact --nocapture`.

| Mutation | Failing scenario |
|---|---|
| Ignore the selected range | `short-range-large-window` |
| Ignore the acquired floor | `below-floor` |
| Ignore the acquired parent prefix | `public-parent-mismatch` |
| Interpret `>=` as `>` | `inclusive-above-floor` |
| Count retained-only images | `retained-rejoin` |
| Count expired images | `lower-bound-expiry` |
| Publish zero instead of `L` | `below-floor` |
| Omit the unknown fact | `below-floor` |
| Mark the coverage miss speculative | `below-floor` |
| Treat an upper bound as a range | `upper-bound` |
| Let null disable a same-column sibling | `null-sibling-is-weakest` |
| Use the range path before Whole | `whole-expired-backlog` |

### Restored implementation checks

Commands below ran from `snapback4/` unless noted. All mutants were restored
before the final native checks. Counts are Rust/Node test functions, not an
inflated count of each table-driven input.

| Check | Final affected-scope result |
|---|---|
| `cargo test -p snapback4-device --test unread_range --test row_keyed_views --test row_view_expiry` | 7 + 23 + 10 passed; the shared runners execute all 48 scenarios on memory and SQLite, including reopening. |
| `cargo test -p snapback4-core --lib engine::row_views` | 12 passed, including reservation, durable-cursor, numeric-witness and new defensive tests. |
| `cargo test -p snapback4-core --test row_view_accounting --test row_view_disclosure --test row_view_legacy --test row_view_witness` | 6 + 18 + 1 + 3 passed; the unchanged 587-case generated disclosure corpus passed. |
| `cargo test -p snapback4 --test scale_row_ranges --test scale --test scale_windows_expiry --test check` | Initially 3 + 20 + 7 + 71 passed; after adding the guide/renamed-field certificate test, `scale_row_ranges` passed 4/4. |
| `cargo test -p snapback4-lang --test guide` | 86 passed, after correcting the old ordinary-aggregate quote in the fact fixture. |
| `node --test --test-concurrency=1 packages/snapback4/test/unread-range.test.mjs packages/snapback4/test/row-keyed-view.test.mjs` | 56 passed, 0 failed, 0 skipped; 52.701 s. |
| `bun run build` in `packages/snapback4`, CLI build, wasm build | Passed. |
| Root `./ref-check --verbose` | `ref-check: ok — 514 LLP docs, 9448 refs in 26813 files, 0 errors, 0 unchecked` |
| `git diff --check`; changed-source length check | Passed; every changed source stays below 1,500 lines. |

Three round-0 fixtures intentionally change with revision 2: the same-column
null sibling now certifies; the large-group short-range case now acquires a
`Key` window rather than `Whole`; and the partial meter-cut case likewise
uses a covered `Key` range. Whole retains its original live-basis path and
zero/pending cut behavior, while `L` is confined to the range path.

### One complete round-1 run

After restoring every mutant and finishing all implementation changes, ran
exactly once from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=12 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

Exit code **0**. Exact final summary:

```text
== 0 failure(s) in 3319 s
```

Every stage passed: cargo build (7 s), wasm build (26 s), docs budget (3 s),
release guard (3 s), package typecheck (2 s), package build (2 s), chat app
check (0 s), cargo test (1,185 s), chat app typecheck (1 s), Expo app typecheck
(1 s), fixture wrapper tests (13 s), client tests (1,837 s), and client models
(254 s). The full wasm build reproduced 2,024,555 B raw / 582,024 B gzip.

The client stage reported 2,280 tests: **2,270 passed, 0 failed, 10 skipped**.
The model stage reported **78 passed, 0 failed, 0 skipped**, including 5,000
online session sequences, 5,000 local session sequences and 3,000 integrated
client interleavings. The two memory legacy old-page cases that hit readiness
timeouts in round 0 both passed in this complete run.

The ten conditional client skips were existing platform/fixture requirements:

| Skipped checks | Count | Requirement to run |
|---|---:|---|
| Expo native media filename/URI/cache lifecycle | 1 | macOS Foundation and AVFoundation |
| Managed organization/invitation policy | 1 | `SNAPBACK4_B1D_MANAGED_BIN`, `SNAPBACK4_B1D_MANAGED_BIN_SHA256`, `SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT` |
| Managed OIDC trusted-email profile | 1 | `SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT` pointing at an existing private directory |
| Published 0.2.27 search-bound reference | 1 | `BOUNDS_BINARY` pointing at the published binary |
| Published 0.2.33 F2 compatibility | 1 | `SNAPBACK4_F2_LEGACY_BIN` pointing at the published platform binary |
| Published 0.2.33 capability fences and capability-free control | 4 | `SNAPBACK4_FENCE_PUBLISHED` pointing at an npm tarball cache directory |
| Actual published 0.2.32 sync request contract | 1 | `SNAPBACK4_LEGACY_BIN` pointing at the published binary |

Full-run failures by classification: **ours 0, baseline 0, environmental 0**.
No repair or affected-test rerun was necessary after the full run, and it was
not repeated. The complete log is `/tmp/p5-r1-test-sh.log`; its exit status is
also recorded in `/tmp/p5-r1-test-sh.exit`.

### Completion and open problems

No open revision-2 implementation problem and no design deviation. The
unchanged server-walk and remembered-answer-expiry exclusions described above
remain outside this lane. The optional checks listed above are the full-run
coverage limits; the broken `llp-orient` link and native-only visit
instrumentation are recorded under scope decisions. The 70 B wasm margin is
small but passes the unchanged gate.

Implementation commits are `4afe0f1e7` (Whole/selector/RFC and boundary
evidence), `8b57cda21` (certificate/check/guide and fallback fences), and
`764ea0b2c` (measured work, defensive tests and size-preserving metadata reuse).
The report and one appended round-1 journal entry follow in a documentation
commit. Every round-1 commit has the requested Astra co-author footer. Nothing
was pushed or published.
