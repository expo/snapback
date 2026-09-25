# Lane T: round-2 delta-review fixes, 2026-09-25

This addresses `t-r1.astra.md` and `t-r1.grok.md` on branch
`sb4-intent/t-read-through`, following round-1 commit `7daaa51ae`.
Implementation commits: `5c4ad5a22` (existence/adoption) and `bf8a3b76a` (bounded work/disclosure).
No push or package publication. The scope remains increments 1 and 3;
read-through sync/devices and the broader guide rewrite remain deferred.

## Behavior and examples

- A value-dependent rule, such as `view totals: count children by .parent`
  with `read <- .value = 2`, authorizes the actual live total. If the source
  expires, declare a physical source bound such as `cap 4 by parent` on
  `children`. Before looking up the group, the interpreter reserves the same
  heap, examined and step allowance for an empty group, a live group and a
  group represented only by expired physical contributions. Denied reads
  restore dependency tables and the next expiry to their pre-recount marks.
  Tight ceilings produce identical unavailable SQL replies or native
  `E_BOUND` refusals, with identical meters. No exhausted charge is erased.
- `exists totals[parent = p, value = v]`, with `v: int ?`, first establishes
  aggregate presence. Null never makes an absent or unreadable group present.
  `totals[p]` retains the distinction between authorized zero and unauthorized
  null. An occupied readable group still matches `v = 1` in the regression.
- A parent with `until: time default 300`, adopted at time 100, can change to
  `until: time default 150` at time 200. Activation stamps deadline 150 through
  the middle and leaf, even though it is already due. It still retires expiry
  under the previous schema first, and still refuses an actually missing
  parent atomically. Ordinary writes still resolve only live parents.
- A key-only rule, for example `read <- .parent = .parent`, needs no recount
  cap. Neither does a non-expiring source whose stored aggregate is already
  the actual value. A missing or unpinned cap for an expiring value-dependent
  rule produces `E_MAINTAIN_READ_BOUND`, a declaration site, and a cap or
  group-key-audience rewrite. Raw schema validation enforces the same proof.

## File-by-file changes

All paths below are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/live_aggregate.rs` | Extracts live recounting from `read.rs`; reserves bounded pre-authorization work and enforces the source cap while traversing contribution batches. |
| `crates/snapback4-core/src/engine/mod.rs` | Registers the aggregate module. |
| `crates/snapback4-core/src/engine/read.rs` | Reserves before occupancy lookup; uses prepaid recounts and zero images; snapshots/restores dependency tables with the denial meter and expiry marks. |
| `crates/snapback4-core/src/engine/through_activation.rs` | Recaptures present parents even when their newly interpreted deadline is due; absent parents still refuse. |
| `crates/snapback4-core/src/maintain.rs` | Proves physical recount bounds from source caps and group keys; identifies rules requiring actual-row authorization. |
| `crates/snapback4-core/src/schema.rs` | Rejects unbounded value-dependent authorization for raw schemas. |
| `crates/snapback4-lang/src/bind/program/reads.rs` | Adds aggregate presence to the extra-equality `exists` lowering before those equalities. |
| `crates/snapback4-lang/src/bind/schema.rs` | Emits the located `E_MAINTAIN_READ_BOUND` diagnostic and rewrite. |
| `crates/snapback4-lang/src/diag.rs` | Routes the new code to the maintains card. |
| `crates/snapback4-lang/src/guide/codes.rs` | Registers the refusal and explanation. |
| `crates/snapback4-lang/src/guide/maintains.md` | Documents the refusal and concrete repair; no unrelated guide rewrite. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pins the new code's defining fact. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pins its repair. |
| `crates/snapback4-lang/tests/read_through/review_cases.rs` | Shared memory/SQLite/PostgreSQL regression cases for work, dependencies, nullable extra equalities, due-at-adoption deadlines and a positive membership witness. |
| `crates/snapback4-lang/tests/read_through_review.rs` | Runs shared cases on SQLite and memory, asserts SQL completeness/availability, preserves SQL cut metadata, and checks compiler/raw-schema bound admission. |
| `experiments/postgres/tests/read_through_review.rs` | Runs the same shared cases and SQL metadata assertions on isolated PostgreSQL. |
| `../llp/3000.014-a-child-reads-through-its-parent.rfc.md` | Records the round-2 implementation corrections beside the existing strict physical-child deletion decision in §11. |
| `metrics/wasm-budget.json` | Records the fresh control measurement and raises the artifact-size ratchet from 501,000 to 503,000 gzip bytes. |
| `JOURNAL.md` | Appends the dated landing, measurements, verification and non-claims. |
| `reports/20260925-intent-lane-t-round2.md` | This report. |

No changed source exceeds 1,500 lines; extraction leaves `read.rs` at 1,391.
No store format or cursor format changes.

## Regression evidence

- `aggregate_denial_work`: compares empty, occupied and expired physical
  groups, under narrow and million-character source declarations; exercises
  heap, examined and step cuts plus default and ample ceilings. SQL comparisons
  include the complete reply except the deliberately different fixture sequence.
  Memory compares the complete refusal/value and every meter field.
- `aggregate_denial_dependencies`: independently checks `tables`, `next_expiry`,
  complete and available authoritative nulls under sufficient ceilings.
- `aggregate_existence`: includes nullable extra-equality arguments in absent,
  unreadable, empty, occupied and expired-parent worlds, plus scalar zero/null.
- `expiry_default`: runs the three-level 300-to-150 change with second adoption
  at both 100 and 200, then checks parent/middle/leaf visibility at 149/150/200.
- `aggregate_authorization_requires_a_physical_recount_bound`: rejects no cap
  and an unpinned cap, rejects a raw schema with its cap removed, and admits
  a group-key-only rule without a cap.
- `a_non_expiring_aggregate_needs_no_recount_cap`: preserves bounded stored-value
  authorization without imposing a source cap.
- `probe_meter_equivalence`: retains the absent/unreadable comparisons and now
  requires Alice's positive membership to permit insertion, a page row and count 1.
- Existing actual-row, delete/reuse, lifecycle, atomic missing-parent adoption,
  25-ID tied-sort cursor exhaustion, issue tracker, chains and Clique tests pass.

Negative controls restore the round-1 production implementation while keeping
these regressions: exactly five fail, one each for compile-time bounds, uniform
work, dependency metadata, extra-equality existence and due-at-adoption expiry.
A separate mutation making every `seats` probe false fails the positive witness.
All temporary mutations were restored before final qualification.

Targeted qualification: 33 read-through tests plus 80 guide tests passed.
PostgreSQL: all 15 selected tests passed with ignored tests explicitly enabled,
using this lane's isolated cluster. The cluster was stopped afterward.
Reference validation: 508 LLP documents, 9,284 references, zero errors and zero
unchecked references. `git diff --check` passed.

## Measurements and implementation choices

Fresh same-toolchain control `7daaa51ae`: 1,793,057 raw / 500,855 gzip bytes.
Round 2: 1,797,060 raw / 502,035 gzip bytes. Delta: +4,003 raw / +1,180 gzip.
Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt. This is a whole-artifact
comparison, not an independent component attribution. The first measurement
exceeded the old artifact ratchet by 1,035 bytes; the permitted 503,000-byte
ratchet leaves 965 bytes. Runtime ceilings are unchanged.

The proof conservatively uses a physical source cap whose columns are determined
by bare group keys (including an admitted capture alias), not data-dependent
observations or calendar keys. A bounded read pays the full cap allowance even
on a miss; reusable recount scratch keeps the existing 32-row buffer bound.
These are implementation choices within the requested uniform reservation.
Existing explicit-rule fixtures now declare a source cap as required by the new
refusal. The diagnostic documentation is the minimum required tested text.

No requested fix was deferred. No new syntax, sync/device support, general guide
rewrite, or unrelated baseline repair was added. No open reproduction remains
from these reviews. The prior stricter physical-child deletion decision stands.

## Full suite and failure accounting

Ran once from `snapback4/`:

```sh
TMPDIR=/dev/shm/sb4-intent-lane-t-tests CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 scripts/test.sh
```

Exact result: `== 0 failure(s) in 451 s` (exit 0).
No failing step: no ours, baseline or environmental failures in this full run.
Rust: 2,996 passed, zero failed, 16 ignored across 887 target invocations.
Client tests: 1,557 total, 1,547 passed, 10 skipped, zero failed.
Build, wasm size, release guard, guide/docs, TypeScript, app checks, fixture
wrappers, Rust and client tests all passed.

Earlier development failures were ours and resolved: a test helper used
`as_list` instead of `as_array`; the positive page witness initially treated the
array result as an object; a compiler positive control compared a reference to
a text literal; and two guide census checks exposed the missing default-card
routing for the new code. The pre-fix regressions and explicit mutation controls
failed intentionally as described above. The initial wasm size-gate failure was
ours and resolved through the documented artifact ratchet. No baseline or
environmental test failure was attributed to this change.

Logs under `~/sb4-intent/`: `lane-t-r2-qualified.log`,
`lane-t-r2-negative-controls.log`, `lane-t-r2-probe-mutant.log`,
`lane-t-r2-pg.log`, `lane-t-r2-wasm.log`, `lane-t-r2-wasm-control.log`,
`lane-t-r2-ref-check.log`, and `lane-t-r2-test.log`.
