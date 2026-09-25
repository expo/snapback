# Lane T round 10 — retained fallback source identity

Branch: `sb4-intent/t-read-through`, based on round-9 head `a845f614d`.
Reviews: `~/sb4-intent/reviews/t-r9.astra.md` and
`~/sb4-intent/reviews/t-r9.grok.md`. Governing design: LLP 3000.014 §5,
with the user's round-10 source-identity clarification.

## What changed, file by file

- `crates/snapback4-core/src/value.rs`: adds transient source identity to
  `ObjectFields`; value equality ignores it, and ordinary serialization still
  carries application fields only. Moves the recursive mask to its own module.
- `crates/snapback4-core/src/value/provenance.rs`: defines `(table, id)`,
  inheritance from agreeing row bases, recursive masks and their preflight
  heap/work allowance. A mask object has `source`, `retained` and `fields`;
  arrays contain element masks, scalar masks are null.
- `crates/snapback4-core/src/engine/provenance.rs`: stamps authorized source
  images before projection, reserving steps and heap before allocation.
- `crates/snapback4-core/src/engine/mod.rs`: registers that module and adds
  `Context::with_row_provenance()` for explicit server envelope requests.
- `crates/snapback4-core/src/engine/local.rs`: enables source tracking for
  device reads when the schema contains delivered history, including other
  source tables in a composed answer.
- `crates/snapback4-core/src/engine/read_candidate.rs`: attaches source
  identity to authorized page candidates before their public projection.
- `crates/snapback4-core/src/engine/read_point.rs`: attaches source identity
  to admitted point answers and marks retained read-through point images in
  the same provenance used by pages. Ordinary retained point reads keep their
  existing component composition and data shape.
- `crates/snapback4-core/src/engine/runner.rs`: preserves source identity
  through shapes/spreads and charges the full mask under steps, heap and
  output bytes before transport.
- `crates/snapback4/src/serve.rs`: accepts `{args, provenance: true}` on `/q`
  and returns `rowProvenance` for available answers. Ordinary replies remain
  unchanged; unavailable answers carry no source envelope.
- `packages/snapback4/src/local.ts`: requests the envelope only for retained
  fallback and passes it to the merge. No clock site changes; 1,499 lines.
- `packages/snapback4/src/local-through.ts`: pairs arrays by table-qualified
  provenance, recurses with each matching pair's masks, prefers the current
  server image and appends unpaired retained history. Missing or ambiguous
  identity keeps the local subtree incomplete.
- `crates/snapback4-core/tests/pending_metadata_heap.rs`: updates the exact
  retained-mask heap oracle to the new recursive representation; one byte below
  its reservation still refuses.
- `crates/snapback4-device/tests/read_through.rs`: asserts the actual retained
  source identity instead of the retired boolean-only mask.
- `crates/snapback4-device/tests/read_through_review.rs`: tests an expired,
  physically present matching child on memory and SQLite; delete queues
  without a predicted row or terminal refusal.
- `crates/snapback4-lang/tests/read_through_provenance.rs`: checks source
  propagation, non-forgeable serialization, equality, authorization and
  envelope metering in compiled Quarry programs.
- `packages/snapback4/test/helpers/read-through-server.mjs`: shares the actual
  server/device harness, preserving wasm and native execution and controlled
  sync delivery.
- `packages/snapback4/test/read-through-provenance.test.mjs`: eight real-device
  cases covering reordered/shifted outer pages, cross-table equal IDs and
  projections without `id`, each on wasm and native.
- `packages/snapback4/test/read-through.test.mjs`: uses the shared harness,
  checks identityless fallback, extends reused-parent deletion with a retained
  child followed by a live child, and adds expired-child queueing on both tiers.
- `../llp/3000.014-a-child-reads-through-its-parent.rfc.md`: records the
  identity-envelope rule in §5 and supersedes round 9's projected-ID merge.
- `metrics/wasm-budget.json`: records the measured artifact and the 516,000-byte
  artifact ratchet, with runtime ceilings unchanged.
- `JOURNAL.md`: one dated append of the implementation, measurements and limits.
- This report: file map, examples, regression/mutation evidence and qualification.

## Existing forms that now compose correctly

No syntax or refusal code was added. These compiled forms are in the tests:

```quarry
fn rowsFor(parent: parents):
  return children where .parent = parent first 10 by .id {roomId: .parent, body}
query outer():
  parents where .visible = true first 10 by .rank {title, rows: rowsFor(.id)}
```

For local `[A, B]` and server `[B, A]`, each retained child remains under its
source parent. For local `[A, B, C]` and server `[A, C]`, C keeps C's history;
the unmatched B wrapper keeps B's history. Neither parent nor child needs a
projected `id`.

```quarry
query page(parent: parents):
  children where .parent = parent first 10 by .id {roomId: .parent, body}
```

A retained copy and a current server copy of the same source row become one
current row. A composed array containing `children/x` and `reactions/x` keeps
both, even when both project `id: 'x'`.

```quarry
mutation dropTask(id: tasks):
  delete tasks[id]
```

A retained child followed by a live matching child still terminally refuses
deletion. An expired, unswept matching child queues without local deletion.
These assertions strengthen existing admission behavior; production deletion
code is unchanged in this round.

## Regression and mutation evidence

- The new fallback file runs four reproductions on each device tier. It checks
  actual masks from device reads, actual opt-in server envelopes, resulting
  row placement, deduplication and incomplete/fresh flags. Ordinary server
  replies have no envelope, and the opt-in envelope increases output charges.
- `source_identity_survives_shapes_and_agreeing_spreads_without_changing_values`
  covers point/page reads, renamed IDs, same-source and conflicting spreads,
  nested objects, equality and serialization. Conflicting sources remain unknown.
- `denied_rows_have_no_identity_and_envelopes_pay_output_and_heap` checks hidden
  rows and tight heap/output ceilings.
- `expired_unswept_matching_child_queues_parent_delete` proves the physical
  row exists, the parent remains, and the operation enters the outbox without
  a prediction, on both device adapters. The same scenario runs on wasm/native.
- Updated retained metadata tests preserve the independent heap oracle and
  reject forged application provenance. Identityless synthetic wrappers keep
  local history and remain incomplete.
- Requested mutations were applied individually, tested, then restored:
  - Index zip: **four failures**, reordered and shifted cases on wasm and native.
  - `return Ok(false)` at the first retained child: **one native failure**;
    deletion incorrectly predicted `tasks/t` despite the later live child.
  - Removing the expired-child check: **one Rust failure**; terminal
    `E_PARENT_HAS_CHILDREN` replaced non-predictable queueing.
- Final focused run: **62 Rust tests passed**, **20 client tests passed**.
  The compatibility rerun also passed both existing `MQ points` cases, plus
  the same 20 read-through client tests. Typecheck and `git diff --check` passed.

## Decisions, limits and measurements

No deviation from the requested identity principle. Engineering choices where
the brief was silent: the explicit envelope switch is `provenance: true`;
the response field is `rowProvenance`; device `retainedRows` now holds the richer
mask. Repeated identities in one array are ambiguous and keep that local array
incomplete. Synthetic wrappers and spreads from conflicting sources do the
same. This deliberately changes the old singleton-wrapper expectation: for
`[{rows: childrenPage}]`, there is no wrapper source identity, so fallback keeps
the local wrapper instead of inventing a positional match.

Source identity is output-only metadata. It does not change stored rows, sync
images, value equality, application fields, the public `Read` contract or clocks.
No runtime ceiling, authorization rule or server physical-child protection is
weakened. No guide rewrite, publication or push was performed.

Rust 1.97.0 / wasm-bindgen 0.2.127, no wasm-opt: **1,834,169 bytes raw /
515,083 bytes gzip**, versus round 9's recorded 1,828,449 / 511,215: **+5,720
raw / +3,868 gzip** for the whole artifact. This is not independently attributed
component cost or a freshly rebuilt control. The initial 512,000-byte budget
check failed (our artifact increase); the documented 516,000-byte ratchet
leaves **917 bytes** headroom. Runtime ceilings remain unchanged.

No unresolved Round-10 reproduction. The conservative identityless/ambiguous
fallback is intentional and remains visibly incomplete.

## Full qualification

First run: `== 1 failure(s) in 1356 s` (client-tests phase). Its two failing
cases were **ours**, not baseline or environmental:

- `MQ points wasm: retained history and independent held coverage`
- `MQ points process: retained history and independent held coverage`

The new point-level retained mark was also reaching ordinary retained tables,
diverting their certified component composition into read-through fallback and
leaving an independent held page at 25 local rows instead of 26 server rows.
Restricting that mark to read-through tables preserves the old component path
and ordinary point result shape. Both unchanged regressions pass after the fix;
the requested read-through cases still pass. No test expectation was weakened.
The first run otherwise passed all 3,047 Rust tests and 1,599 client tests, with
16 Rust ignores and 10 client skips.

Corrected full rerun, exit 0:

```text
== 0 failure(s) in 1153 s
```

The Rust target runner passed **3,047 tests**, with **16 ignored**; the docs
budget also rechecked one guide test. Client results: **1,601 passed, 10 skipped,
0 failed** (1,611 total). No baseline or environmental failure was waived.
All build, typecheck, fixture, guide, release-guard and artifact-budget phases
passed. The full build confirms the final 515,083-byte gzip measurement.

Both runs used this host configuration from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
taskset -c 32-47 env TMPDIR=/dev/shm/sb4-intent-lane-t-tests \
  CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 \
  SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Logs: `~/sb4-intent/lane-t-r10-test-attempt1.log` and
`~/sb4-intent/lane-t-r10-test.log`. Requested mutation logs are
`lane-t-r10-mut-index.log`, `lane-t-r10-mut-retained.log` and
`lane-t-r10-mut-expired.log` in that same directory. The recorded host baseline
was read before classifying failures.

Implementation commits: `04db26c43` (source identities/envelope), `7ba43b80b`
(identity merge and regressions), and `88b13aae7` (ordinary-point compatibility).
`ref-check --verbose`: **508 LLP docs, 9,296 references in 25,927 files,
0 errors, 0 unchecked**. `git diff --check` passed. All touched source files
remain under 1,500 lines. No push or publication was performed.
