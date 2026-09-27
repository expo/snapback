# Lane CQ — round 1

Branch: `sb4-intent/cq-topn-complete`. Implementation: `bb7fe7cd8414d26a0302eed7642eb251afccdda2`.
Round 0 and both full reviews were read.
Merge `60007c0ad` brings in `origin/main`; the only conflict was JOURNAL.md,
and both complete append blocks were kept. Nothing is pushed or published.

## Result and file map

Paths are relative to `snapback4/` except the LLP.

| File | Round 1 change |
|---|---|
| `../llp/3000.027-top-n-answer-is-complete.rfc.md` | §2 records the supervisor's cursor/cursorless collector distinction, the unnecessary lookahead removal, and the paths retaining lookahead |
| `crates/snapback4-core/src/engine/read.rs` | Plain cursorless query pages fetch at most their remaining slots and stop at N; preserve cursor, merge, distinct discovery, horizon, streaming, meter-domain, mutation and job paths |
| `crates/snapback4-core/src/engine/mod.rs` | Server completeness directly includes `!value_source_incomplete` |
| `crates/snapback4-core/src/engine/local.rs` | Same completeness veto for both device stores |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Same completeness veto for the evaluation adapter |
| `crates/snapback4-lang/src/guide/search.rs` | Put the reads card's completeness definition before the full-first-1 statement |
| `crates/snapback4-sim/tests/common/topn_boundaries.rs` | Shared twelve-item, five-room fixture and exact data/meter/collector/discovery assertions |
| `crates/snapback4-sim/tests/topn_complete.rs` | Run the boundary fixture on the server |
| `crates/snapback4-device/tests/topn_complete.rs` | Run the same boundary fixture through local query execution over SQLite and memory |
| `crates/snapback4-lang/tests/repairs.rs` | Trending candidate window costs 8,190 examinations, retaining exact winner and excluded-winner checks |
| `crates/snapback4/tests/scale/witnesses.rs` | Preserve exact mutation charges and abort behavior; query receipts omit overflow charges while certificates stay conservative |
| `crates/snapback4/tests/scale_extremum_expressions.rs` | Assert the five-row certificate and four actual examinations separately for shaped and plain pages |
| `crates/snapback4/tests/scale_row_ranges.rs` | Keep extra seeded rows and exact live-view receipts without cursorless overflow work |
| `JOURNAL.md` | Preserve both merge sides and append the round 1 result |
| `reports/20260927-cq-topn-complete/ROUND1.md` | This report |
| `reports/20260927-cq-topn-complete/round1-wasm.json` | Same-toolchain baseline/candidate sizes and hashes |
| `reports/20260927-cq-topn-complete/round1-qualification.json` | Check results, failure ownership and source/log hashes |

There is no collector implementation change. No authorization, fallback,
N_NO_CURSOR, search membership planning, budget or package-version change.

## Forms and tests

No new syntax. These existing forms compile and execute in the shared fixture:

| Form/example | What the new assertions prove on all three hosts |
|---|---|
| `return items last 10 by .n` | Returns 11 through 2, complete at examined ceiling 10, without examining row 11 of the scan; ceiling 9 returns nine rows with meter cut and incomplete |
| `return items first 10 by .n` | Same exact-N and before-N boundary in ascending order, with exact values checked |
| `return items last 10 by .n after c` | With `c: cursor ?`, lookahead still charges the eleventh examined row: full page at ceiling 10 remains cut/incomplete with next; ordinary ceiling is complete with next |
| `for i in items[] last 5 by .n: … break` | Return `[11]`, complete, no cut or next |
| Same loop with `after c` | Return `[11]`, incomplete, no cut or safe next |
| `for i in items: …` | The meter-bounded domain remains incomplete at ceiling 10; a runtime ceiling is not a declared top-N answer |
| Explicit room merge below, with a distinct room-id source in IR | Two of five rooms omit the room containing newest item 11: result item 10, incomplete, no cut or next; all five rooms return item 11 complete |

The added test is `bound_meter_collectors_and_lane_discovery` on the server
and its `sqlite_…` / `memory_…` counterparts on devices. The existing round 0
tests continue to cover 1,000 matching rows, composed previews, unknown horizon,
undecided authorization and hidden rows. Device boundary tests use real store
adapters and explicit ceilings through `local::query_with_coverage`; they also
assert that these known-source cuts do not request fallback.

## Deviation and reproduction

The requested literal form has a baseline authoring limitation:
`where .room in (rooms first 2 by .id)` does not currently compile.
`rooms first 2` yields room rows, whereas `.room` has type `rooms` reference:

```text
E_QUARRY_TYPE: in compares a rooms reference with a rooms row
rewrite: use a list of values of the column's type
```

No compiler redesign was attempted. The runtime regression compiles the
equivalent explicit merge and sets its existing IR `distinct` field to `r.id`,
which exercises `discovering_values && has_more` and the completeness flag:

```quarry
query discovered():
  return merge items last 1 by byRoomN:
    [r.id] for r in rooms first 2 by .id
```

The schema declares `by byRoomN: room, n, id`. There are five public synced
rooms; the newest item is in room r4, outside the two opened rooms. This is a
runtime distinct-source test, not a claim that the literal membership spelling
now compiles. To reproduce, put this in a project's `snapback/schema.q` and
run `snapback4 check` there:

```quarry
table rooms:
  public 'rooms'
table items:
  room: rooms
  n: int
  public 'items'
query discovered():
  return items where .room in (rooms first 2 by .id) last 1 by .n
```

The ready local reproducer and its actual CLI diagnostic are
`target/cq-round1/membership-repro/snapback/schema.q` and
`target/cq-round1/membership-repro.log`. From `snapback4/`, run
`(cd target/cq-round1/membership-repro && ../../debug/snapback4 check)`.
The initial test diagnostic is also preserved in `target/cq-round1/server-before.log`.

Preliminary test-development errors were lane-owned and corrected: the first
explicit-merge fixture used statement-loop syntax instead of the merge's
`[r.id] for r in …` spelling; its IR match initially used a named field for the
tuple Return variant; and an extra index-entry assertion expected physical
scan work in a caller counter that correctly remains zero. The examined
boundary assertions remain exact. These were not full-suite failures.

## Qualification

Affected checks before the required full run:

| Check | Result |
|---|---|
| New and existing top-N regressions | Server 2/2; devices 8/8 |
| Server clique/continuation/cut tests, helper pages and top-N | 298 passed, one existing ignore |
| Full device crate, including authoring census and disclosure sweeps | 1,327 passed, three existing ignores, 68 targets including doctests |
| Whole guide | 86 passed |
| Cursor advice | 2 passed |
| Lowering census | 11 passed |
| Core corpus harness | 18 passed; SQLite cases 212 passed / 83 skipped; disabled Postgres 295 skipped |
| Reference audit | 518 documents, 9,638 references, zero errors or unchecked references |
| Source/whitespace | Every changed source under 1,500 lines; diff check passes |

The single `scripts/test.sh` invocation exited 1 with this exact summary:

```text
== 1 failure(s) in 3447 s
   cargo test
```

All other stages passed, including 2,700 client tests (10 skips) and all 78
client-model tests. No baseline or environmental failure occurred in this
full run. The optional Postgres check below is a separate baseline failure.
The Rust stage recorded 3,909 passed, five failed and 24 ignored across 965
result executions, including doctests. The full run took 3,447 seconds;
the inherited 60-second suite budget remains exceeded and unchanged.
Raw logs are retained under ignored `target/cq-round1/`. The full run uses eight Cargo
jobs, eight Rust test processes, eight threads per Rust test process and
the existing serial-client-files option, with dev/test debug information
and incremental compilation off and fd limit 65,536. Test populations,
timeouts and budgets are unchanged.

Full-run Rust failure inventory (all five are lane-owned):

| Target / test | Original failure | Correction |
|---|---|---|
| `snapback4-lang::repairs` / `trending_card_finds_winners_only_inside_its_declared_candidate_window` | 8,190 examined versus expected 8,191 | Remove the obsolete overflow-row charge from the expectation; preserve all winner/window assertions |
| `snapback4::scale` / `witnesses::mutation_scan_includes_admission_before_traversal` | 21 examined versus expected 22 | Restrict the shortcut to queries, preserving mutation admission and lookahead; query receipt legitimately falls from 21 to 20 |
| `snapback4::scale` / `witnesses::repeated_mutation_scans_cover_admission_near_and_across_the_ceiling` | 5,460 examined versus expected 8,190 | Restore aborting mutation charges; the query loop legitimately falls from 8,000 to 4,000 |
| `snapback4::scale_extremum_expressions` / `shaped_page_prices_the_same_five_examinations_as_its_unshaped_twin` | 4 examined versus expected 5 | Separate the conservative five-row certificate from the four actual examinations, retaining exact checks for both |
| `snapback4::scale_row_ranges` / `live_view_page_and_point_certificates_cover_real_receipts` | 300 examined versus expected 303 | Price 100 returned cursorless rows, preserving the extra seeded row and certificate upper-bound checks |

These failures are recorded as failures of this run even after their fixes;
no second full-suite run or replacement green summary was made.
The correction limits the shortcut to capped query execution, restoring
aborting mutation admission and lookahead. It updates only the intentionally
reduced query receipts; scale certificates and mutation assertions are retained.
All 38 tests in the three affected scale targets pass after that correction.
The final whole guide (86), repairs (10), cursor advice (2), and lowering
census (11) also pass: 109 tests. Every full-run failure is corrected and
passes its affected target; the original aggregate remains red.

Final runtime reruns also pass: device top-N/authorization census/prediction
91 tests; server clique/helper pages/top-N 298 tests with one existing ignore;
core corpus 18 tests, with the same named substrate skips. These follow the
query-only guard correction. The full device run above and the one full suite
precede that correction; neither is relabeled as a run of the final candidate.
Final workspace and package builds pass. The rebuilt native/web artifacts
pass all eight W13b routing/cut tests and all 40 wasm artifact, budget and
codec-family census tests. Final affected totals: 554 Rust and 48 Node tests,
zero failures, one existing Rust ignore. No second full suite was run.

Wasm, same Rust 1.97.0 / wasm-bindgen 0.2.127 / worktree-local Binaryen 123:
merged round 0 baseline 1,981,159 B raw / 572,011 B gzip; round 1 candidate
1,981,375 B raw / 572,099 B gzip. Delta +216 raw / +88 gzip; unchanged
572,841 B budget, 742 B headroom. Exact hashes and the earlier full-suite
candidate's measurement are in `round1-wasm.json`.
No tool was installed this round; Binaryen was already in this worktree's
ignored `target/cq-tools/` from round 0. Frozen Bun installation passes.

No live Postgres service is qualified by this lane. The optional
`cargo check -p snapback4-core --features postgres` fails with baseline E0061:
`engine/postgres/through.rs:168` passes three arguments to `activate_columns`,
whose fourth argument is `Option<&mut AdoptionReport>` (declaration in
`engine/column_activation.rs:41`). Both sites are untouched by CQ. A fresh
archive of merge commit `60007c0ad`, using `cargo check --offline --locked`
with the same feature, reproduces the identical error. Logs:
`target/cq-round1/postgres-check.log` and `postgres-baseline.log`. No unrelated
Postgres repair was made. The requested completeness expression was updated,
but this is not a successful Postgres qualification claim.

The literal membership spelling above remains the requested-form limitation.
