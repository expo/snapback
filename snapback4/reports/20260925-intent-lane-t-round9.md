# Lane T round 9 — device delta review fixes

Branch: `sb4-intent/t-read-through`, based on round-8 head `482d77ac2`.
Reviews: `~/sb4-intent/reviews/t-r8.astra.md` and
`~/sb4-intent/reviews/t-r8.grok.md`.

## Scope and governing context

Used `llp-orient` for the scoped read-only design check: LLP 3000.014 §§3–5
owns lifetime, captured identity, current/retained coverage, prediction and
clock publication; LLP 3000.001’s “never install a confirmed image over a row
a live prediction writes” owns restore/replay publication. LLP 3000 is the
Snapback 4 root, separate from the legacy root’s checks. LLP 3000.014 is in the
current working set. This round changes device admission, fallback composition
and publication invalidations; no authoring form or refusal code is added.

## What changed, file by file

- `crates/snapback4-core/src/engine/through.rs`: device parent-delete admission
  now checks current child coverage and scans each reference prefix under the
  bounded device authority allowance. Retained history is ignored. Only a live,
  current child with matching captures proves terminal `E_PARENT_HAS_CHILDREN`.
  Mismatched, expired or uncovered witnesses produce `E_PREDICT`, preserving
  outbox admission. Heap scratch is reused per row; exhaustion queues. The
  server keeps its existing physical-child probes, charges and fixed refusal.
  Capture comparison is shared with reads and includes `$parentDeadline`.
- `crates/snapback4-core/src/engine/through_read.rs`: calls that shared capture
  comparator, retaining the same four-outcome resolver semantics.
- `crates/snapback4-device/src/device/predictions.rs`: restore and successful
  replay return the tables whose rows they restored or wrote. Returning both
  sets covers changed values at the same ID, newly written tables, and vanished
  predictions; rolled-back speculative writes do not enter the replay set.
- `crates/snapback4-device/src/device.rs`: merges both sets into `touched` inside
  the authoritative publication transaction, including empty clock pages.
- `packages/snapback4/src/local-through.ts`: recursively composes array/object
  masks; a retained mask-true row is appended only when its ID is absent from
  the current server array. The server image wins during partial rejoin;
  deleted history remains marked retained.
- `crates/snapback4-device/tests/read_through_review.rs`: two regression tests,
  each running on memory and SQLite (details below).
- `packages/snapback4/test/read-through.test.mjs`: extends both fallback tests
  with partial-rejoin deduplication and a nested page; adds recursive helper
  coverage and the reused-parent deletion on wasm and the native process.
- `../llp/3000.014-a-child-reads-through-its-parent.rfc.md`: records the device
  delete witness distinction and atomic replay invalidation behavior in §5.
- `metrics/wasm-budget.json`: records the measured artifact and the authorized
  size-ratchet increase to 512,000 bytes; runtime ceilings are unchanged.
- `JOURNAL.md`: one dated append with changes, measurements and scope limits.
- This report: file map, examples, regression and mutation evidence, and
  qualification accounting.

## Existing forms now behave correctly

The tests compile and execute these forms; no syntax was added.

```quarry
mutation drop():
  delete parents['p']
```

A reused parent with an empty, fully held current child group can predict its
removal even when the device retains old children. A mismatched current child
queues that call without a local deletion. A current matching live child still
refuses terminally; server physical protection remains in force.

```quarry
query nested(parent: parents):
  rows = children where .parent = parent first 10 by .id { id, body }
  return [{ rows }]
```

An unknown parent takes server fallback while preserving nested retained
history. If `old` appears in both server and retained pages, it appears once,
using the current server image. If deleted on the server, it remains retained.

```quarry
mutation add():
  if now < 300:
    insert notes {id: 'n', at: now}
```

Admitted at 100, this non-expiring prediction replays to `at: 200` when an
empty authoritative page advances the clock to 200. `touched` includes `notes`.
At 300 the prediction disappears and `notes` is again invalidated.

## Regression tests and sensitivity

- `reused_deadline_is_part_of_current_capture_identity`: same parent ID and
  owner, deadline changes 300 → 500, old current child remains locally. Before
  replacement the page is complete with expiry 300; afterward it is empty,
  unknown and incomplete, without an unavailable cut. Deleting the replacement
  queues rather than terminally refusing. Runs on memory and SQLite.
- `authoritative_replay_invalidates_written_and_withdrawn_tables`: no expiring
  table or incoming row can mask the bug. An empty time-200 page rewrites
  `notes/n` and first writes `later/l`; `touched` lists both. At 300 both rows
  disappear and both tables are invalidated. Runs on memory and SQLite.
- Both existing `an unheld parent falls back without losing retained rows`
  tests now read during a partial rejoin before deletion, proving no duplicate,
  then after deletion, proving retained history survives. The nested query
  asserts the actual device mask `[{rows:[true]}]` and the merged result.
- `retained fallback recursively merges masks and prefers server IDs`: tests
  duplicate IDs with different bodies, a deleted retained row, nested objects
  inside arrays, and another array/object nesting level.
- Both `retained children do not terminally refuse a reused parent delete`
  tests leave the old child group, delete/reuse the parent on the server, apply
  only the replacement parent image, and admit deletion. The retained row
  remains readable, prediction succeeds, and the server accepts the deletion.
  One test executes the actual wasm artifact; the other uses the native device.

Observed failures with the defective code:

1. Original wasm delete: terminal `E_PARENT_HAS_CHILDREN` at `dropTask:2`.
2. Original fallback: server `old` plus retained `old`, failing the new rejoin
   assertion.
3. Original replay: `at` changed to 200 with `touched: []`.

Deliberate mutation checks (all mutations restored):

| Mutation | Witness | Result |
|---|---|---|
| Remove `$parentDeadline` from the shared comparator | deadline-only reuse | Fails: stale `c` emitted, complete true |
| Restore plain concatenation | recursive/dedup helper | Fails: duplicate `live` with stale body |
| Drop array recursion, keep ID deduplication | actual wasm nested fallback | Fails: retained `old` disappears |
| Drop restored-table invalidation | clock replay | Fails at 300: `[]` instead of both withdrawn tables |
| Drop replay-written-table invalidation | clock replay | Fails at 200: only `notes`, missing `later` |

Logs: `~/sb4-intent/lane-t-r9-mutation-{deadline,concat,nested,restore,replay}.log`.

## Qualification

Implementation commits: `93eb75576` (device) and `888e081b9` (fallback and
wasm/native regressions), both with the required co-author trailer.

Final `scripts/test.sh`: **`== 0 failure(s) in 1220 s`**, exit 0.
Rust: **3,044 passed, zero failed, 16 existing ignored tests**.
Clients: **1,601 total; 1,591 passed, zero failed, 10 existing skipped tests**.
Every blocking script check passed; the full-run log has no failure markers.
Final `ref-check --verbose`: 508 LLP documents, 9,294 references in 25,921
files, zero errors and zero unchecked references. `git diff --check` passes.

Full-suite command, from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
taskset -c 32-47 env TMPDIR=/dev/shm/sb4-intent-lane-t-tests \
  CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 \
  SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Log: `~/sb4-intent/lane-t-r9-test.log`. The command uses the passing round-8
qualification configuration; no test or assertion is skipped by it.

Focused checks: all ten wasm/native read-through client tests pass; package
TypeScript checking passes; the existing two prediction write-set tests and
the two new memory/SQLite tests pass. The nine original device read-through
cases pass. Server-focused checks pass: nine original read-through tests,
35 review regressions and 14 transaction/adapter tests (58 total). `bun install --frozen-lockfile` completed without changes.

Wasm: **1,828,449 bytes raw / 511,215 bytes gzip**, Rust 1.97.0,
wasm-bindgen 0.2.127, without wasm-opt. Against round 8’s recorded
1,824,505 / 509,390, the whole artifact adds 3,944 raw / 1,825 gzip bytes.
This is not independent component attribution or a newly rebuilt control.
The old 510,000-byte artifact ratchet was exceeded by 1,215; the prescribed
ratchet procedure records 512,000, leaving 785 bytes. All runtime meters retain
their existing ceilings.

## Failure accounting, decisions and open problems

- The reproduced defects and intentional mutation failures above are ours and
  fixed; mutation failures are expected proof results.
- Two test-setup errors were ours: the first expiry fixture seeded deadlines
  300/500 under real time, and the first assertion expected an explicitly
  serialized `unavailable: false` although false is omitted. The fixture now
  writes at time 100; the assertion checks that unavailable is not true.
- One cargo invocation accidentally ran from the repository root and failed
  on its unavailable legacy `ibex-runtime` path. It was rerun in `snapback4/`;
  no legacy bootstrap or dependency change was made.
- The first wasm build correctly failed the inherited size ratchet; the final
  build passes the documented 512,000-byte ratchet. This is an artifact-size
  change, not a raised runtime work ceiling.
- An optional `cargo test -p snapback4-device` run with default disk-backed
  temporary storage and default concurrency was interrupted while unrelated
  SQLite search/calibration cases were still running. It reported no assertion
  failure before the explicit SIGINT; it is an incomplete attempt, not a pass.
  The required full suite uses the round-8 RAM-backed temporary directory and
  constrained concurrency, and includes all of those tests.
- The host baseline tail was read. Its recorded cargo failure has not been
  used to excuse any failure in this round.
- Engineering decisions where the brief was silent: expired current child
  witnesses queue conservatively because only the server can confirm physical
  sweeping; replay invalidates the union of restored and successfully written
  tables even when a restored value later happens to be identical. This may
  conservatively wake a watch and prevents missing invalidation.
- Touched source files remain below 1,500 lines; the largest is `device.rs`
  at 1,127. `local.ts` was not edited.
- No requested fix is deferred. No known open product problem remains in this
  round’s scope. No push, package publication, client clock-site rewrite,
  guide-card rewrite, wire-format change or runtime-ceiling increase occurred.
