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
