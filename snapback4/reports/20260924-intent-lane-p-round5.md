# Lane P — round 5: reserve once

Date: 2026-09-24. Branch: `sb4-intent/p-expiry`.
Implementation and tests: `bf3f276c9`; ownership ordering: `b650e2d1b`.
Fixture codec: `c9dc1bb78`; clock fixture: `1f49934e1`. No push or publication.

## Root cause and fix

An upsert reserves `2R + U + 2I` before target lookup. On a device, the absent
arm spends both read probes proving absence. Re-entering `insert_attempt`
then demanded another `R + I`. With `read <- exists grants[.id, viewer]`,
insert/update allowed, and 8,190 prior probes, the server committed while the
device returned `E_BOUND`. Admission treated that as a local failure and lost
the outgoing intent. The same defect appeared with no prelude and a ceiling
of two: the device requested a third probe.

Ordinary insert/insert-if-absent now reserve at `insert_mode` only. Upsert's
shared insert arm uses its existing reservation. Every actual rule check and
all ceilings remain unchanged; both upsert callers still reserve before lookup.
Ordinary insertion's engine-owned guard also stays before schema lookup, so a
timeline purge still refuses forbidden writes with `E_TIMELINE_OWNED`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/write.rs` | Move ordinary insertion's reservation out of the shared insert arm. |
| `crates/snapback4-device/src/device.rs` | Register the regression module. |
| `crates/snapback4-device/src/device/upsert_reservation_tests.rs` | Both adapters, exact 8,190-probe admission, custom preflight ceilings, refusal control and row agreement. |
| `crates/snapback4/tests/expiry_writes/review.rs` | Share the existing readable-but-denied fixture and add the denied-delete whole-reply comparison. |
| `crates/snapback4/tests/clock.rs` | Bracket the grace deadline's later clock sample by admission completion in two timing-sensitive assertions. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Record the reservation lifetime and delete-charge requirement. |
| `JOURNAL.md` | Append the dated implementation and qualification record. |
| `reports/20260924-intent-lane-p-round5.md` | This report. |

No new syntax or diagnostic. Existing forms remain compiled and exercised:

```text
upsert records['target'] { amount: 1, until: null }
insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt }
insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt } if absent
delete messages[conversationId = 'chat', ordinal = ordinal]
```

## Regressions and measured checks

- `upsert_insert_reserves_once_after_8190_probes_{memory,sqlite}`: the prelude
  spends exactly 8,190 probes. Server commit and device admission agree; the
  device keeps one outbox entry and predicts the server's row, with its pending
  marker. The device prelude is also checked directly at 8,189/8,190 allowances.
- `upsert_insert_at_preflight_ceiling_{memory,sqlite}`: both accept with a
  two-probe ceiling and refuse with one. The smaller ceiling uses the production
  prediction adapter and interpreter without adding a public configuration API.
- `readable_but_undeletable_targets_hide_expired_siblings_in_the_whole_reply`:
  a positive read control succeeds; delete refuses `E_RULE`. Complete serialized
  replies match with zero/3,000 hidden expired siblings, examined is zero, and
  storage is unchanged. Moving only the expiry charge above delete denial makes
  this test fail with 3,000 examined. The production file was restored exactly.

Targeted results: four new device tests pass in 0.37 s; all 30 expiry tests pass
in 13.29 s. The existing 9,000-send tests still assert `examined == 1` on every
send with zero/3,000 unrelated expired rows. The reference audit passes with
505 LLP documents, 9,239 references, zero errors or unchecked references.
After the ownership-order correction, all five timeline-authority tests pass
in 0.19 s and all four new device tests pass in 0.32 s.
Final wasm: 1,754,267 B raw / 487,923 B gzip, +224 / +107 from round 4; the
unchanged 488,000 B gzip budget passes with 77 B spare. Source files remain below
1,500 lines. The first candidate measured 1,754,255 B raw / 487,922 B gzip.

## Decisions and remaining limits

No round 5 design deviation or open defect. One additional test-fixture
correction was needed for qualification: grace deadlines are sampled after the
mutation's timestamp, so the existing upper-bound assertion used the wrong
observation. It now uses admission completion, keeping the 35-second bound,
positive deferral, delivery, duplicate suppression and restart assertions.
Custom-ceiling tests call the existing
private adapter; the exact default-ceiling schedule uses real admission.
Earlier decisions remain: expiring-cap growth queues when physical occupancy
is unknown; secondary expired collisions await sweep. Reproduce the former
with cap 1 and an expired row omitted from a fresh snapshot; reproduce the
latter by inserting a new id with that expired row's unique key under a full
cap. Earlier presence-heap and scheduling findings remain recorded in
[round 4's report](20260924-intent-lane-p-round4.md).

## Full qualification and failures

First full run: **`== 2 failure(s) in 780 s`**, exit 1. Rust finished in 131 s:
one timeline authorization test failed (`E_SCHEMA` versus `E_TIMELINE_OWNED`).
Clients finished in 723 s: 1,098 tests, 1,086 passes, two failures, ten skips.
Both client failures were `wasm-codec-census.test.mjs`:
`web-reachable typed JSON calls all use the codec funnel` and
`census kills parse, encoded, MQ components and container regressions`.
Every other harness step passed. All three failing tests are introduced by this
round, not baseline or environmental. The guard fix is described above.
The new unit fixture now decodes its snapshot and queued entry through the
existing text decoder, satisfying the census without changing its rules.
All 26 census checks pass in 9.37 s, and the four device regressions still pass
in 0.32 s with that decoder.
The first run finished before the corrected full run began.

The second full run's Rust inventory finished in 147 s with one failure:
`grace_push_serve_keeps_deadline_and_reconnect_record_for_claim_after_restart`.
Its effect had `at=1790283291569`, `nextAt=1790283326570`: 35,001 ms. The fixture
assumed the later presence sample could never cross a millisecond after the
mutation's earlier `at`. The release fixture has no insert/upsert path; it passed
in the first full run, unchanged. Classified **environmental/timing exposure of
a pre-existing fixture assertion**, not a baseline-recorded failure or a write
regression. Bracketing the later sample by the completed admission removes the
false comparison without increasing the grace constant or any timeout. Both
affected assertions are corrected; all three grace-push tests pass in 0.06 s.

Second full run: **`== 1 failure(s) in 759 s`**, exit 1. Rust's sole failure is
the clock assertion above. Clients passed in 712 s: 1,098 tests, 1,088 passes,
zero failures, ten skips. The corrected codec-census tests passed. All other
harness steps passed. No introduced or baseline failure remained in that run;
the environmental/timing fixture failure is corrected in the third run.

Final full run: **`== 0 failure(s) in 748 s`**, exit 0. Rust passed in 129 s,
including all 83 core unit tests, 40 device unit tests, 30 expiry regressions,
18 clock integration tests and 25 simulator review tests. Clients passed in
716 s: 1,098 tests, 1,088 passes, ten skips, zero failures. All other harness
steps passed. No introduced, baseline or environmental failure remains in this
qualification. Final reference audit: 505 LLP documents, 9,239 references in
25,679 files, zero errors or unchecked references.

All full runs use
`CARGO_INCREMENTAL=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh`.
Full harnesses do not overlap; at most one full Rust inventory runs at once.

Development failures, corrected before qualification:

- Mine: initial fixture filename namespaced its operations, causing four
  `UnknownOp` failures. Use the normal `schema.q` name.
- Mine: two warm-up checks incorrectly expected ordinary device queries to
  charge delivered-read probes. Mutation prediction is now measured directly;
  ordinary queries legitimately trust those delivered rows.
- Mine: four successful prediction comparisons initially included the device's
  pending marker. Now assert that marker explicitly and compare stored content.
- Mine: the first full Rust run found that the moved preflight could return
  `E_SCHEMA` before the timeline purge's required `E_TIMELINE_OWNED` refusal.
  Moved the existing ownership guard to the ordinary entry as well; upsert
  retains its own ownership guard. All five timeline authorization tests pass.
- Mine: two client census tests found direct `serde_json::from_value` calls in
  the new unit fixture. An initial attempt to split its cfg attributes still
  failed: the scanner does not inherit this nested module's cfg. Reverted that
  attempt. `json_codec::from_value` also failed the owned-decoder restriction;
  the existing text decoder passes, with no census exception.
- Expected pre-fix regressions: all four final boundary fixtures fail against
  the old runtime, showing device `E_BOUND` and server success.
- Expected mutation control: the early-delete-charge variant fails the new
  denied-delete test; restored before all final checks.

Logs outside the checkout use `~/sb4-intent/lane-p-round5-`: `before.log`,
`repro.log`, `repro-final.log`, `device.log`, `device-final.log`,
`early-charge-mutation.log`, `expiry.log`, `refs.log`, `wasm.log`, `suite.log`.
Follow-up logs: `timeline.log`, `device-guard.log`, `wasm-guard.log`,
`refs-final.log`, `codec.log`, `codec-final.log`, `codec-text.log`,
`device-codec.log`, `device-text.log`, `suite-final.log`.
Clock fixture qualification: `clock.log`. Final qualification: `suite-complete.log`.
Final reference audit: `refs-complete.log`.
The recorded host baseline ends `== 1 failure(s) in 276 s` (`cargo test`);
none of the development fixture failures above is attributed to that baseline.
