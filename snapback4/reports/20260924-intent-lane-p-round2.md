# Lane P — round 2 review closure

Date: 2026-09-24. Worktree: `~/sb4-intent/lane-p`.
Branch: `sb4-intent/p-expiry`. Implementation: `e589c0866`.
No push, merge, version bump or publication.

## Choice: retain deferral

Round 2 explicitly permits either round 1's deferral or transporting physical
occupancy. I retained deferral for writes that increase an expiring cap's
occupancy. No counter fields were added to snapshots or the sync stream.

A counter sent at the device's last delivered watermark cannot decide the
review's reverse schedule before any post-sweep message arrives:

1. Cap is 1. The device receives one row and, hypothetically, physical count 1.
2. The row expires. The device has the same local time and evidence in both
   server worlds.
3. World A keeps the expired row physically present. World B sweeps it but its
   deletion/count update remains in transit.
4. A new-id insert must refuse on A and succeed on B. Every local input,
   including the last received counter, is identical.

A local acceptance or refusal cannot match both worlds. An ordered counter
update would resolve this after delivery; it cannot resolve it beforehand.
This is not a claim that physical-count transport is impossible in general.
It could improve provisional predictions at a delivered cut, but does not
provide the agreement requested for this undelivered-sweep schedule. The
permitted deferral meets that schedule without adding a new consistency or
visibility contract.

The device queues the write durably without predicted rows and lets the server
settle it. Same-cap-group updates, deletes and existing occupancy-neutral
replacements retain their prior prediction behavior. At 9,000 live rows an
occupancy-increasing write on an expiring cap still queues; no under-cap
prediction claim is made. The server examines exactly one row per send.

## What changed, file by file

Paths are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4/tests/expiry_writes.rs` | Assert `examined == 1` for every one of 9,000 inserts, for both 0 and 3,000 unrelated expired rows. Tighten isolated unique/cap checks to 1 too. Keep certificate checks. |
| `crates/snapback4/tests/expiry_writes/devices.rs` | Add paired swept/unswept server worlds, warm/post-expiry snapshots, all four insert forms, both cap shapes and both device adapters. Compare complete delivered snapshots and queued entries; check reopen, settlement and ordered delayed deletion delivery. |
| `crates/snapback4-core/src/engine/postgres/tests.rs` | Register the PostgreSQL cap test module under the existing evaluation test runner. |
| `crates/snapback4-core/src/engine/postgres/tests/caps.rs` | Two tests execute physical count reads and transactional updates through the real PostgreSQL adapter, including cap refusals and legacy backfill. |
| `crates/snapback4-core/src/engine/write.rs` | Explain why a counter at the last delivered watermark cannot remove uncertainty about an undelivered sweep; runtime behavior is unchanged from round 1. |
| `crates/snapback4-lang/src/guide/prediction.rs` | Explain the reverse schedule beside the existing deferral policy. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Record the round 2 choice, its concrete counterexample, strengthened assertions and actual PostgreSQL testing in §11.1. |
| `JOURNAL.md` | Append one dated round 2 entry with the choice, measurements, fixture failure and final qualification. |
| `reports/20260924-intent-lane-p-round2.md` | This report, including reproduction commands and limitations. |

Every changed source file is below 1,500 lines. No new Quarry syntax or refusal
code was introduced. No runtime meter or wasm budget was raised.

## Forms exercised

These are existing forms in the compiled expiry fixtures, not new spellings.
On the server they enforce the maintained physical cap; occupancy-increasing
operations queue without a prediction on the device.

| Form | Example in the `messages` fixture |
|---|---|
| Insert | `insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt }` |
| Insert-if-absent | `insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt } if absent` |
| Unique-key upsert | `upsert messages[conversationId = 'chat', ordinal = ordinal] { at, expiresAt }` |
| By-id upsert | `upsert messages[id = messageId] { conversationId: 'chat', ordinal, at, expiresAt }` |
| Same-group update | `update messages['old'] { at: 20 }` |
| Unique-key delete | `delete messages[conversationId = 'chat', ordinal = 1]` |

`expire at .expiresAt`, `cap 1` and `cap 1 by conversationId` compile and run
in these fixtures. The large reproduction uses `cap 200000` and null expiries
for all 9,000 inserted rows.

## Tests and measurements

- **Strengthened 9,000-send reproduction:** every send asserts `examined == 1`
  with unrelated backlogs of 0 and 3,000. The certificate must be constant and
  name the same-full-key backlog, maintained physical count and one-second /
  2,000-row sweep policy. The addressed conversation is the single examination.
- **Strengthened isolated constraints:** unique plus cap, unique alone and cap
  alone, each over 9,000 unrelated live rows and either backlog, assert exactly
  one examination for the same send.
- **New undelivered-sweep regression:** 32 paired schedules, covering both
  device adapters, both snapshot timings, table/group caps and four insert
  forms. Both worlds receive identical snapshots and persist identical queued
  entries without predicted rows. The unswept server refuses `E_CONSTRAINT`;
  the swept server accepts. Reopen preserves the queue. Delivering the held
  deletion page before the insertion page leaves no predecessor, then exposes
  the server-confirmed replacement.
- **Existing fresh-after-expiry regression:** retained and rerun. One expired,
  unswept server row and a complete empty live snapshot queue without falsely
  predicting space. Server refusal settles the queue. This runs on memory and
  SQLite devices, for table/group caps and all four insert forms.
- **Real PostgreSQL counter test:** absent and nonzero counts, table/column/group
  key separation, group moves, zero-count deletion, savepoint rollback, full
  transaction rollback, reopen and backfill after removing the legacy counter
  table all execute through `Tx::cap_count` and its actual SQL.
- **Real PostgreSQL constraint test:** an expired unswept row fills its group;
  another group can consume the remaining table slot; a third insert is refused
  by the table cap. Refusals leave no row behind. Physical deletion releases
  capacity and a replacement succeeds. Each cap-only mutation examines 0 row
  images. The evaluation adapter has no sweep host, so this test uses its
  physical `Rows::delete` path, not a claimed PostgreSQL sweep worker.

The assertion that PostgreSQL `Tx::cap_count` always returns 0 is stale: the
implementation already selects `n` from `_cap_counts` by table and encoded key,
falling back to 0 only for an absent counter. Both new PostgreSQL tests passed
against PostgreSQL 16.15 in a private, socket-only cluster. Therefore the SQL
was tested through the real driver; a substitute SQL-string unit test was not
needed. The cluster used separate data and port from the lane whose temporary
binaries were reused, and was stopped after testing.

Commands, from `snapback4/` with the required toolchain PATH:

```sh
CARGO_INCREMENTAL=0 cargo test -p snapback4 --test expiry_writes -- --nocapture
# 22 passed; 0 failed; 4.66 s

# SNAPBACK4_EVAL_POSTGRES points to an isolated local PostgreSQL database.
CARGO_INCREMENTAL=0 cargo test --locked -p snapback4-core --features postgres \
  --lib engine::postgres::tests::caps -- --include-ignored --nocapture
# 2 passed; 0 failed; 0 ignored; 0.05 s
```

The PostgreSQL tests remain explicitly ignored without an isolated database,
like the adapter's other execution tests. `scripts/test-postgres.sh` includes
both via its existing `engine::postgres::tests --include-ignored` invocation.
The full default harness does not enable the PostgreSQL evaluation feature;
the separate execution above is additional evidence.

Reference audit: 505 LLP documents, 9,236 references, zero errors and zero
unchecked references. `git diff --check` passes.

## Root cause and remaining limits

The original 0.4.0 failure came from the expiring **cap check scanning the live
population**, not the full-key unique lookup. Earlier Lane P commits replaced
that scan with transactionally maintained physical counts. Unswept expired
rows conservatively retain capacity until deletion. Round 1 fixed expiry
charges preceding write authorization and made devices defer when physical
cap occupancy is unknown. This round tightens their evidence and records the
choice; it does not replace those fixes.

There is no unresolved regression from this round. Two explicit limits remain:

- **No occupancy transport / no prediction for occupancy-increasing expiring
  cap writes.** Reproduce with cap 1, one row, then its expiry and a server sweep
  held in transit. The same device evidence corresponds to server success or
  refusal. The new test named
  `an_undelivered_sweep_cannot_make_either_device_accept_or_refuse_an_expiring_cap_write`
  demonstrates both worlds. This is the round 2 permitted choice, rather than
  implementation of the preferred transport alternative.
- **Secondary expired unique collisions remain until sweep.** Reproduce with
  cap 1 and an expired `old` row, then insert `new` with the same secondary key:
  `E_CONSTRAINT` names the write site and tells the caller to retry after the
  one-second sweep tick, at most 2,000 rows per pass. Sweep, then retry succeeds.
  Immediate retirement remains deferred under the round 1 ruling because the
  ordinary removal tail could disclose a never-live membership's group/id.
  `a_never_live_grant_stays_silent_across_watermarks` remains required.

## Full qualification and failure accounting

The required full harness was invoked once this round with:

```sh
CARGO_INCREMENTAL=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Final result: **`== 0 failure(s) in 790 s`**, exit 0.

The complete Rust inventory passed in 160 s, including all 22 expiry tests,
57 guide tests and 25 disclosure reviews. Client inventory: 1,098 tests,
1,088 passes, 10 skips and zero failures (714 s). All build, documentation,
release-guard, typecheck and fixture steps passed.

Wasm: **1,753,421 B raw / 487,644 B gzip**, unchanged from round 1, within the
488,000 B budget. No new budget adjustment.

One intermediate **introduced test-fixture failure** occurred: the first
PostgreSQL constraint test requested `add` from a fixture named `caps.q`, whose
compiled operation was `caps.add`, and got `UnknownOp("add")`. Naming the fixture
`schema.q` fixed it; both real PostgreSQL tests then passed. The first binary
probe also needed the extracted tools' `libpq` directory on `LD_LIBRARY_PATH`;
that was an environmental invocation adjustment, not an adapter failure.

The baseline tail was read before qualification: it records
`== 1 failure(s) in 276 s` in `cargo test`. That baseline failure did not recur.
The final full run has **no introduced, baseline or environmental test failure**.

Logs outside the checkout:

- `~/sb4-intent/lane-p-round2-expiry.log`
- `~/sb4-intent/lane-p-round2-postgres.log` (initial fixture failure)
- `~/sb4-intent/lane-p-round2-postgres-final.log`
- `~/sb4-intent/lane-p-round2-refs.log`
- `~/sb4-intent/lane-p-round2-suite.log`
