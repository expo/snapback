# Lane P — round 4 device expiry review

Date: 2026-09-24. Branch: `sb4-intent/p-expiry`, on top of round 3.
Implementation and regressions: `18a992521`.
Acquisition fixture correction: `1d1e6ed65`.
No push, merge, version bump or publication.

## Changes and root causes

1. The cap check treated a device's expired same-id predecessor as preserved
   capacity, skipping enforcement. The device cannot know whether the server
   swept that predecessor and refilled the slot. Only on the device, the cap
   check now passes no predecessor for that expired image. It therefore queues
   without a predicted row and rolls back tentative cleanup. The server keeps
   its physical predecessor and can still replace it within the same cap group.
2. Alternate-key delete treated every device miss as unknown. It now uses the
   existing `upsert_absence_proven` check: proven absence returns `NOT_FOUND`
   locally, leaving no outbox entry; unproved absence queues. Round 3's
   authorization reservation remains before lookup and absence resolution.
3. Deferred expiry charging already followed update authority. A new test now
   protects that boundary even when read authority succeeds.
4. The prediction adapter already forwarded `cap_count` correctly. Its new
   direct tests protect that forwarding; ordinary expiring-cap writes defer
   before calling it, which explained the previous coverage gap.

## Files

Paths are relative to `snapback4/`, except the parent RFC.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/write.rs` | Discard expired cap predecessors on the device only; correct the same-id comment. |
| `crates/snapback4-core/src/engine/write_target.rs` | Check sync absence proof before queueing a delete miss. |
| `crates/snapback4-device/src/device.rs` | Register counter tests under `cfg(test)`; no change to its production counter. |
| `crates/snapback4-device/src/device/cap_counts_tests.rs` | Test the private prediction adapter on memory and SQLite. |
| `crates/snapback4/tests/expiry_writes/devices.rs` | Register review cases and update the deliberately changed expired-replacement expectation. |
| `crates/snapback4/tests/expiry_writes/devices/review.rs` | Paired stale-cap worlds and proven/unknown delete absence cases. |
| `crates/snapback4/tests/expiry_writes/review.rs` | Whole-reply comparisons for readable but unwritable targets. |
| `crates/snapback4-lang/src/guide/writes.rs` | Explain stale same-id capacity and local delete absence. |
| `packages/snapback4/test/acquisition.test.mjs` | Hold delivery during pending-write setup so recovery assertions cannot race successful server settlement. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Correct the earlier prediction claim and record round 4 decisions. |
| `JOURNAL.md` | Append one dated entry and qualification. |
| `reports/20260924-intent-lane-p-round4.md` | This report. |

No new syntax, refusal code, protocol field or author-visible bound. All changed
source files remain below 1,500 lines.

## Forms exercised

With the test's declared messages schema, these existing forms compile and run:

```text
insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt }
insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt } if absent
upsert messages[id = messageId] { conversationId: 'chat', ordinal, at, expiresAt }
upsert messages[conversationId = 'chat', ordinal = ordinal] { at, expiresAt }
delete messages[conversationId = 'chat', ordinal = 999]
update messages[conversationId = 'chat', ordinal = ordinal] { at: 20 }
```

## Tests

- `same_id_expiry_replacements_queue_across_an_undelivered_sweep_and_refill`:
  32 scenarios: four insert/upsert forms, whole-table/group caps, two server
  worlds, two adapters. A snapshot holds `old`; local time passes its expiry.
  World A retains the predecessor; world C sweeps and refills with `filler`,
  withholding sync. Whole snapshots and queued entries match. Neither device
  predicts or loses the predecessor on deferral/reopen. A accepts replacement,
  C refuses `E_CONSTRAINT`; settlement and ordered sync leave exactly the right
  live image and no queued entry.
- `alternate_delete_refuses_proven_absence_and_queues_unknown_absence`:
  both adapters refuse a complete public-sync miss locally. Horizon-limited,
  online-only and unacquired misses queue. Reopen preserves only the intended
  queues, and no message row appears.
- `readable_but_unwritable_targets_hide_expired_siblings_in_the_whole_reply`:
  update and upsert compare serialized complete outcomes at zero/3,000 hidden
  expired siblings. The live target is readable to Alice, but update is denied.
  The refusal is `E_RULE`, examined is zero, and storage is unchanged.
- `predicting_cap_counts_follow_memory_changes_restore_reopen_and_reset` and
  `predicting_cap_counts_follow_sqlite_changes_restore_and_reset`: call the
  private adapter's actual counter through whole-table/group changes,
  savepoints, full rollback, restored predictions and reset. Unswept expired
  rows count physically; memory persistence also rebuilds the same counts.

Mutation controls: constant-zero `Predicting::cap_count` failed both tests with
0 instead of 2. Charging expiry after a successful read but before update
authority failed the reply test with 3,000 examined instead of 0. Production
sources were restored byte-for-byte before qualification.

## Decisions and remaining limits

No round 4 requirement was deferred or redesigned. One additional test-fixture
correction was needed for full qualification: acquisition recovery expected
writes to stay pending while allowing their server responses to arrive. Its
existing busy mode now holds delivery during setup, then the original offline
reopen and online recovery assertions run unchanged. No product behavior,
assertion or timeout was weakened.

Filtering the predecessor
inside the cap branch keeps other constraint inputs intact. Only an expired
device predecessor loses its occupancy claim; server behavior and live neutral
predictions stay intact. Direct adapter unit tests avoid exposing a new API just
for testing an internal count that current deferral bypasses.

Earlier limits remain:

- Expiring-cap occupancy growth queues even after full live acquisition.
  Reproduce cap 1 with an expired server row omitted from the fresh snapshot.
  This round extends that deferral to a locally held expired same-id image.
- Secondary expired collisions await sweep. With cap 1, an expired old-id row
  and a new-id insert sharing its secondary key, replacement refuses until
  sweeping frees capacity. Immediate retirement still needs lifecycle provenance
  to preserve the never-live-grant disclosure invariant.
- The separate presence heap issue remains: a two-principal absence conjunction
  followed by `emit notify {}` needs 1,967 server heap bytes versus the recorded
  1,961 device allowance. This round does not change that issue.
- Default parallel client scheduling timed out once in round 3's native
  232-pending-ID transport test. That test passed isolated and in serial full
  qualification. This round uses the existing serial-client option.

## Qualification and failure accounting

Targeted qualification: **29 expiry tests passed in 13.27 s**; both device
counter unit tests passed. Every one of the 9,000 sends still asserts exactly
one examined row with either zero or 3,000 unrelated expired rows. The reference
audit passed: 505 LLP documents, 9,238 references, zero errors or unchecked refs.

Wasm: **1,754,043 B raw / 487,816 B gzip**, versus round 3's
1,753,894 / 487,627: **+149 raw / +189 gzip** for the whole artifact. The
488,000 B budget is unchanged, with 184 B headroom.

First full harness: **`== 1 failure(s) in 766 s`**, exit 1, using
`CARGO_INCREMENTAL=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh`.
Rust passed in 130 s (including 36 device unit tests and 29 expiry tests).
Clients finished in 709 s: 1,098 tests, 1,087 passes, one failure and 10 skips.
Every other harness step passed. The sole failure was the acquisition race
below, at the offline-reopen pending assertion (`acquisition.test.mjs:375` in
the pre-correction source). This run finished before the final run began.

Final full harness: **`== 0 failure(s) in 753 s`**, exit 0, with the same flags
and the corrected fixture. Rust passed in 128 s. Clients passed in 722 s:
1,098 tests, 1,088 passes, 10 skips and zero failures. The formerly failing
acquisition case passed, as did all three native maximum-pending-ID transport
cases. Every other harness step passed. No introduced, baseline or environmental
failure remains in this final run. Only one full Rust inventory ran at a time;
the two full harnesses did not overlap.
The final reference audit also passed (505 documents, 9,238 refs in 25,677 files,
zero errors or unchecked refs). Logs outside the checkout use
`~/sb4-intent/lane-p-round4-` with suffixes:
`repro.log`, `repro-fixed-fixture.log`, `expiry.log`, `expiry-final.log`,
`cap-counts.log`, `cap-counts-final.log`, `cap-count-mutation.log`,
`early-charge-mutation.log`, `refs.log`, `refs-final.log`, `wasm.log`, `suite.log`, and
`suite-final.log`.

The first full client's `W5c process: pending writes recover by id through sent
and failed, including settlement before reopen returns` failed. Six isolated
runs passed unchanged. A controlled 200 ms pause between arranging the writes
and asserting their pending states reproduced `sent != pending`: failed sync
did not prevent a mutation response from settling first. Classified
**environmental/timing exposure of a pre-existing fixture race**, not an expiry
runtime regression; this fixture has no expiry, cap or delete. Holding delivery
with the fixture's existing busy mode fixes the schedule, retaining every
recovery assertion. Both wasm and process tests pass with the correction.
Both also pass with that same controlled 200 ms pause (20.71 s total).
Additional logs: `acquisition-isolated.log`, `acquisition-repeat-1.log` through
`acquisition-repeat-5.log`, `acquisition-delay.log`, `acquisition-fixed.log`, and
`acquisition-fixed-delay.log`.

Development failures, all accounted for:

- Mine, corrected: missing `mut` in the reopen fixture (Rust compile failure).
- Mine, corrected: comparing an id column to a text literal (one fixture test,
  two type diagnostics); now uses an optional principal field and viewer.
- Mine, corrected: missing the horizon's `by .id` (one fixture test).
- Mine, corrected: using core SQLite without device side tables (one unit
  test); now opens through the existing device test helper.
- Expected pre-fix failures: the two device review reproductions.
- Expected mutation failures: both zero-counter tests and the early-charge
  whole-reply test. Restored production code before qualification.

The recorded baseline tail is `== 1 failure(s) in 276 s` (`cargo test`). None
of the fixture errors above is being attributed to that baseline.
