# Lane P — round 1 review closure

Date: 2026-09-24. Branch: `sb4-intent/p-expiry`. Implementation: `39864279e`. This report covers the review
fixes after `b51dc16fa` and `457431f10`; the original cap-count implementation
and its qualification remain recorded in [the initial report](20260924-intent-lane-p.md).

## Findings and decisions

1. **Authorization precedes observable expiry work.** Target resolution had
   charged each expired sibling immediately. At 8,193 examinations it raised
   `E_BOUND` before read/update/insert authority, bypassing the `NOT_FOUND`
   path that restores the logical meter. Consequently an empty denied target
   and 9,000 expired siblings returned different complete refusals and meters.
   Resolution now accumulates expiry work privately. Update charges after
   update authority; upsert's insert arm charges after insert authority.
   Denied or unresolved targets restore the ordinary `NOT_FOUND` meter.
   Insert-if-absent already checked insert authority before its unique scans.

   Private resolution itself stops at the remaining examination allowance
   plus one expired sibling; it cannot walk an arbitrarily large denied
   population. A cut update/delete returns `NOT_FOUND`. An upsert can never
   treat that cut as proof of absence: before inserting, its authorized insert
   arm must pay the over-ceiling debt and therefore refuses `E_BOUND`. A later
   live sibling cannot be overwritten or bypassed. This cut behavior is an
   engineering decision where the review was silent; it preserves both the
   refusal-disclosure contract and the existing work ceiling.

   Alternate-key delete previously lowered to an ordinary `Get`, a null check,
   and a by-id delete. Its generated read had the same premature charge. It
   now uses an internal `DeleteTarget` instruction with its existing read and
   delete gates intact. No new Quarry syntax is introduced. Old serialized
   by-id `Delete` remains accepted with its existing meaning.

2. **Expiring cap predictions defer when occupancy could increase.** The
   maintained count is physical and conservative, but snapshots contain only
   live rows. A snapshot taken after expiry therefore cannot establish the
   server's physical occupancy. The shared interpreter now returns `E_PREDICT`
   for occupancy-increasing cap checks on a device. Admission rolls back the
   whole tentative mutation and durably queues it without predicted rows.
   This applies to inserts, missing upserts and cap-group moves. Updates in
   the same group and deletes retain prediction. A same-id expired replacement
   with a held predecessor preserves occupancy in unchanged cap groups too.
   Static `predicts: eligible` keeps its existing meaning: individual calls
   still need their runtime facts; it does not promise a predicted row.

3. **Secondary predecessor removal remains deferred**, as permitted by the
   round 1 ruling. Removing a never-live membership through the ordinary
   deletion tail emits a row id and `scope` for a group its recipient never
   held. The existing `a_never_live_grant_stays_silent_across_watermarks` test
   remains green. A secondary replacement under a full physical cap now
   returns `E_CONSTRAINT` with a write site and a rewrite naming the server's
   one-second tick and maximum 2,000-row sweep pass. It succeeds once sweeping
   removes the predecessor. There is no promise of immediate secondary
   removal or of a fixed maximum backlog age.

4. **The 5,000-sibling regression is sensitive to the target charge.** The
   proper upsert charges the target pass, then reaches 8,193 examinations
   during the constraint pass and rolls back. Temporarily removing the target
   accumulation caused that exact test to fail: the mutation incorrectly
   committed with `examined: 5001` and one row written. The production code was
   restored before qualification.

The original scale root cause remains the expiring cap's live-row census,
not the full-key unique lookup. Maintained physical cap counts eliminate that
scan. With 9,000 sequential inserts and either zero or 3,000 unrelated expired
rows, every send still examines exactly one row: its addressed conversation.

## Files changed this round

Paths in this table are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/read.rs` | Accumulate private expiry work; stop private resolution at the existing examination limit; ordinary read/rule-probe accounting is unchanged. |
| `crates/snapback4-core/src/engine/write_target.rs` | Charge target work after authority; resolve alternate-key delete inside the engine; reject that instruction in update conditions. |
| `crates/snapback4-core/src/engine/write.rs` | Charge authorized insert-arm debt; defer unknown expiring-cap occupancy on devices; preserve same-id replacement occupancy; share the authorized delete tail; emit sweep-timed cap refusals. |
| `crates/snapback4-core/src/error.rs` | Add an internal expiring-cap error carrying a site and fixed rewrite, using existing `E_CONSTRAINT`. |
| `crates/snapback4-core/src/ir.rs` | Add `DeleteTarget` and include its key expressions and table in read, scan and write traversals. |
| `crates/snapback4-core/src/engine/runner.rs` | Execute `DeleteTarget` as a write. |
| `crates/snapback4-core/tests/corpus.rs` | Traverse the new delete target when interpreting corpus page-limit expectations. |
| `crates/snapback4-core/src/engine/admission.rs` | Treat `DeleteTarget` as an impure write. |
| `crates/snapback4-core/src/engine/prefetch.rs` | Visit the new target's expressions for prefetch planning. |
| `crates/snapback4-lang/src/bind/program.rs` | Lower alternate-key delete to the private target instruction; keep by-id delete compatible. |
| `crates/snapback4-lang/tests/lowering/ce15819ad.sha256` | Update exactly 16 program hashes for the intentional alternate-delete lowering. |
| `crates/snapback4-lang/tests/lowering/README.md` | Record the migration and proof that all other serialized IR stays identical. |
| `crates/snapback4-lang/src/bind/program/returned_shapes.rs` | Traverse the delete target when tracking returned-shape dependencies. |
| `crates/snapback4-lang/src/bind/residency.rs` | Include target expressions in residency analysis. |
| `crates/snapback4-lang/src/bind/residency/presence.rs` | Classify delete target keys as write sinks and the instruction as a write. |
| `crates/snapback4/src/scale.rs` | Price alternate-key delete as a keyed write with the matching expiry-backlog term. |
| `crates/snapback4/src/scale/dependencies.rs` | Include alternate delete's target in dependency analysis. |
| `crates/snapback4-lang/src/guide/types.rs` | State deferred secondary removal and unknown device occupancy. |
| `crates/snapback4-lang/src/guide/prediction.rs` | Explain queued occupancy-increasing writes and retained neutral-write prediction. |
| `crates/snapback4-lang/src/guide/writes.rs` | Qualify expiring-cap prediction even after complete acquisition. |
| `crates/snapback4/tests/expiry_writes.rs` | Register the new review regressions. |
| `crates/snapback4/tests/expiry_writes/review.rs` | Five authorization, metering and sweep-policy regressions. |
| `crates/snapback4/tests/expiry_writes/devices.rs` | Durable warm/cold snapshot deferral, server settlement, entire-mutation rollback, and neutral/group-move tests on both stores. |
| `metrics/wasm-budget.json` | Record the measured artifact and raise the size ratchet from 486,000 to 488,000 gzip bytes. Runtime meter ceilings do not change. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Record the private-resolution limit, authorization ordering, queued cap writes and accepted deferred cleanup policy in §11.1. |
| `JOURNAL.md` | Append the dated round 1 implementation and qualification entry. |
| `reports/20260924-intent-lane-p-round1.md` | This review closure report. |

## Forms exercised

These are existing forms with corrected runtime behavior; the test sources
compile through the Quarry binder.

```quarry
update messages[conversationId = 'chat', ordinal = ordinal] { at }
upsert messages[conversationId = 'chat', ordinal = ordinal] { at, expiresAt }
upsert messages[id = messageId] { conversationId: 'chat', ordinal, at, expiresAt }
insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt } if absent
delete messages[conversationId = 'chat', ordinal = ordinal]
delete messages[messageId]
```

Under denied rules each refuses identically with zero versus 9,000 expired
siblings, comparing the complete refusal envelope and every meter field.
Authorized updates and deletes operate on the live matching row after charging
expired siblings. Authorized upserts and insert-if-absent succeed when both
the meter and cap have room. On an expiring cap, occupancy-increasing device
calls queue and settle from the server's decision.

## Tests and measurements

`cargo test -p snapback4 --test expiry_writes`: 21 tests passed before the full
harness, including the original 9,000-insert and counter durability checks.
New and revised regressions:

| Test | Proof |
|---|---|
| `denied_expiry_targets_have_identical_whole_replies_in_both_worlds` | Complete refusal (code, family, message, detail, site, rewrite, guide, rule, retryable) and complete meter equality at 0/9,000 expired siblings for unique update, unique/by-id upsert, insert-if-absent, and unique/by-id delete. |
| `five_thousand_expired_siblings_charge_upsert_target_and_constraint_work` | Both passes count; 8,193 examinations refuse and roll back. The deliberate charge-removal mutation makes the test fail with a 5,001-examination commit. |
| `full_expiring_cap_defers_secondary_replacement_until_the_documented_sweep` | Full cap refuses replacement with code, site and sweep-timed rewrite; old row remains before sweep and is gone when replacement succeeds afterward. |
| `private_resolution_cut_cannot_turn_a_later_live_target_into_an_insert` | A live row ordered after 9,000 expired siblings cannot be bypassed when private resolution cuts; no replacement is inserted. |
| `authorized_update_and_delete_charge_their_expired_target_siblings` | With 3,000 expired predecessors and a live target, update examines 6,003 rows (including unique checks and returned read); delete examines 3,001. |
| `expiring_cap_writes_queue_and_settle_on_both_devices_with_warm_and_post_expiry_snapshots` | Memory and SQLite, table and group cap 1, warm and post-expiry snapshots, insert/if-absent/unique-upsert/by-id-upsert, same and different secondary key. Queues have no predicted rows, survive reopen, settle the server refusal, and later acquire the successful post-sweep replacement. |
| `devices_queue_keyed_writes_at_nine_thousand_live_rows_with_both_backlogs` | Both stores defer a send at 9,000 live rows with 0/3,000 expired rows; the earlier conversation update is rolled back locally, while the server succeeds with one examination. |
| `occupancy_neutral_writes_predict_but_cap_group_moves_queue_on_both_devices` | Both stores still predict same-group update/upsert, by-id/unique delete and same-id expired replacement; a move into another capped group queues. |

`cargo test -p snapback4-sim --test reviews`: 25 passed, including
`a_never_live_grant_stays_silent_across_watermarks`.

The old binder reproduced all 3,219 compiler golden hashes. Exactly 16 programs
change, each solely by replacing its generated delete triple with the private
`DeleteTarget` retaining identical address fields. Only those digests were
updated; no ownership, admission or runtime comparison was excluded.
`cargo test -p snapback4-lang --test lowering`: all 11 tests passed, including
all eight complete golden shards (184.01 seconds).

`cargo check -p snapback4-core --features postgres` passed (3.80 seconds).

`./ref-check --verbose`: 505 LLP documents, 9,236 references, zero errors and
zero unchecked. `git diff --check` passes. Largest changed source: 1,374 lines.

Wasm from the full harness: **1,753,421 bytes raw / 487,644 bytes gzip**,
versus the initial Lane P qualification at 1,748,501 / 485,838: **+4,920 raw /
+1,806 gzip** for the entire artifact, not independent feature attribution.
The 488,000-byte size ratchet leaves 356 bytes. No runtime meter ceiling changed.

Full runs use the requested toolchain PATH, `CARGO_INCREMENTAL=0` and
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh` from `snapback4/`.
Logs: `~/sb4-intent/lane-p-round1-suite.log` and
`~/sb4-intent/lane-p-round1-suite-final.log`.

First full harness: `== 1 failure(s) in 1009 s` (`cargo test`: the fixed
corpus-helper compilation omission). Client tests: 1,098 total, 1,088 passed,
10 skipped, zero failures.

**Final full harness: `== 0 failure(s) in 740 s`**, exit 0. The complete Rust
inventory passed in 135 seconds. Client inventory: 1,098 tests, 1,088 passed,
10 skipped, zero failures (707 seconds). All build, guide, release guard,
package/app typecheck and fixture steps passed. No baseline or environmental
failure remains. The baseline log's earlier failure did not recur.

## Failures, deviations and remaining limits

- The pre-fix reproduction had two expected failures: denied target disclosure
  and missing cap-refusal site/rewrite. Both are fixed.
- Two new-test development failures were fixture mistakes: missing `()` on
  argumentless mutations and an expected update examination count of 6,002
  instead of 6,003 (the returned row adds a read). Both were corrected.
- The deliberate target-charge removal produced the required expected failure;
  no mutated production code remains.
- The first full harness failed to compile the corpus test helper because its
  exhaustive statement match omitted `DeleteTarget`. This was my integration
  omission, not a baseline or environmental failure; the match now traverses
  the target keys. The final complete Rust inventory and full harness pass.
- The subsequent Rust inventory had exactly seven failing golden shards
  (`baseline_golden_and_ownership_switch_shard_0`, `_1`, `_2`, `_3`, `_4`, `_5`,
  `_7`). All were stale serialized-IR expectations caused by this intentional
  compiler change, not pre-existing baseline failures. The 16 affected hashes
  were updated only after the structural comparison described above. Every
  other Rust target passed.
- The first wasm probe exceeded the inherited size ratchet at 487,641 gzip
  bytes. This is attributable to the change. The same-commit documented ratchet
  follows `AGENTS.md`; the final harness artifact is 487,644 bytes and passes.
- Secondary inline cleanup is intentionally deferred under the review's
  permitted alternative. Reproduction: cap 1, old secondary key with expiry 10,
  insert a replacement at clock 100. Before the sweep, `E_CONSTRAINT`; after
  `sweep_expired(100, 2000)`, the old row is gone and the replacement succeeds.
  Trying the ordinary deletion tail instead breaks the never-live-grant
  disclosure regression. No lifecycle/provenance redesign is included.
- The new internal delete instruction and the bounded unresolved-target refusal
  are engineering decisions explained above. Quarry spellings and the runtime
  meter ceilings are unchanged. The byte ratchet is the only raised budget.
- PostgreSQL service execution is not claimed; the device agreement tests run
  SQLite server plus memory and SQLite device adapters. The count-storage
  implementation from the initial commit is unchanged in this round.
- No push or package publication is performed.
