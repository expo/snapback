# LLP 3000.013 Lane P — expiring keyed writes

Branch: `sb4-intent/p-expiry`. Implementation commit: `b51dc16fa`. No push or publication.

**Partial completion under the brief's explicit stop rule:** the live-population
cap scan is fixed. Immediate removal of an expired secondary-unique collision
is stopped because its ordinary deletion events disclose a never-held group.
Full-key collision skipping remains metered; background sweep removes the old
row. This does **not** satisfy the requested immediate old-row-removal case.

## Root cause and measurements

The unique lookup already used the complete `(conversationId, ordinal)` key.
The expiring-table cap branch instead paged through the entire cap group,
decoded each row, and charged `examined` while counting the live rows.
`cap 200000` therefore scanned the table for every insert even when every
`expiresAt` was null. The unmodified reproduction failed exactly at insert
8,193: first insert examined 1 row, insert 8,192 examined 8,192, and the refusal
reported `E_BOUND`, site `sendMessage:8`, examined 8,193 against 8,192.

The isolated checks at 9,000 live rows produced these measurements before the
fix, for both zero and 3,000 expired, unswept rows:

| Constraints | Result | Examined |
| --- | --- | ---: |
| unique + cap | E_BOUND | 8,193 |
| unique only | sent | 1 |
| cap only | E_BOUND | 8,193 |

After the fix all six cases send with **1 examined row**. Two complete runs
of **9,000 sequential inserts**, with backlogs 0 and 3,000, both stay at
**1..1 examined rows per write**. That row is the addressed conversation.
The new regression also binds the measured counters to the operation's
constant-class certificate and checks its explicit sweep policy.

## Decisions and compatibility

Caps on expiring tables use maintained physical occupancy. Unswept expired
rows occupy capacity until the background sweep or an existing by-id replacement
deletes them. This conservative option was explicitly permitted by the brief.
Non-expiring tables retain their existing cap implementation.

Unique constraints retain their complete-key lookup and charge examined rows
only within that key. Secondary uniques and `if absent` share it. Upsert target
resolution now charges expired siblings without changing server rule probes'
population-independent accounting. The examined ceiling bounds an oversized
same-key backlog and the refused mutation rolls back. No unrelated live rows
enter those probes.

Counters are transactional index bookkeeping. SQLite persists them separately
from application rows; activation and old-store opening backfill them once
without changing generation. Memory stores reuse a private namespace in their
transactional index map and reconstruct counters from saved rows on install.
The Postgres evaluation adapter implements the same maintained count and
backfills old stores under its writer lock.

No new syntax, refusal code, package version or runtime ceiling. Existing
spellings remain. One existing expiry/aggregate test now explicitly verifies cap refusal before
sweep, then success after sweep; this is the permitted conservative-cap change.
All disclosure and membership tests retain their original expectations.

Supported examples (inside the tested schema):

```quarry
insert messages { id: messageId, conversationId, ordinal, at: now, expiresAt: null }
insert messages { id: messageId, conversationId, ordinal, at: now, expiresAt: null } if absent
upsert messages[conversationId = conversationId, ordinal = ordinal] { at: now, expiresAt: null }
upsert messages[id = messageId] { conversationId, ordinal, at: now, expiresAt: null }
```

The tested table declarations include `cap 200000`, `cap 1`, and
`cap 1 by conversationId`, alongside `expire at .expiresAt`.

## File map

Paths below are relative to `snapback4/` unless marked otherwise.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/engine/write.rs` | Maintained expiring-cap lookup; primary expired collision examination charge. |
| `crates/snapback4-core/src/engine/read.rs` | Separate metered expiry skips from rule probes' existing disclosure accounting. |
| `crates/snapback4-core/src/engine/write_target.rs` | Meter expired siblings skipped during full-key target resolution. |
| `crates/snapback4-core/src/engine/mod.rs` | Upgrade old counter metadata when opening a stored backend. |
| `crates/snapback4-core/src/rows.rs` | Maintained-cap adapter operation and in-memory implementation. |
| `crates/snapback4-core/src/rows/caps.rs` | Shared counter identity and physical row-transition deltas. |
| `crates/snapback4-core/src/store.rs` | SQLite counter table and metered bookkeeping with put/delete. |
| `crates/snapback4-core/src/store/caps.rs` | SQLite point count and transactional counter transitions. |
| `crates/snapback4-core/src/store/activation.rs` | Counter backfill, schema rebuild and reset in activation's transaction. |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Install evaluation-adapter counters at attachment. |
| `crates/snapback4-core/src/engine/postgres/store.rs` | Postgres point count and put/delete counter bookkeeping. |
| `crates/snapback4-core/src/engine/postgres/caps.rs` | Serialized legacy backfill and counter transitions. |
| `crates/snapback4-device/src/device.rs` | Forward counts through predicting rows. |
| `crates/snapback4-device/src/device/history.rs` | Forward counts through historical rows. |
| `crates/snapback4-device/src/device/deferred/recording.rs` | Forward counts through recording rows. |
| `crates/snapback4-device/src/memory.rs` | Counters share index rebuild, undo, savepoint, commit and reset machinery. |
| `crates/snapback4-device/src/sqlite.rs` | Clear counters with device row reset. |
| `crates/snapback4/src/scale.rs` | Full-key expiring write targets keep constant classification with a collision term. |
| `crates/snapback4/src/scale/writes.rs` | Explain full-key cleanup, maintained cap counts and background sweep policy. |
| `crates/snapback4/tests/expiry_writes.rs` | 9,000-insert, constraint-attribution, measured certificate and CLI tests. |
| `crates/snapback4/tests/expiry_writes/constraints.rs` | Unique reuse followed by sweep, secondary uniques, conservative caps, bounded same-key backlogs and authorization tests. |
| `crates/snapback4/tests/expiry_writes/stores.rs` | Counts through moves, deletes, savepoints, rollback, reset, restart and legacy upgrade. |
| `crates/snapback4/tests/expiry_writes/devices.rs` | Server/native/memory agreement, large fixtures, reopen and prediction withdrawal. |
| `crates/snapback4-sim/tests/review_corrections.rs` | Verify the deliberate conservative-cap behavior before sweep and unchanged live aggregate behavior afterward. |
| `crates/snapback4-lang/src/guide/types.rs` | Conservative cap semantics and accurate bounded sweep cadence. |
| `crates/snapback4-lang/src/guide/language.rs` | Expiry comment states unswept rows occupy cap capacity. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | §11.1 records the runtime decision, counter custody and measurements. |
| `JOURNAL.md` | One dated append-only implementation and qualification entry. |
| `reports/20260924-intent-lane-p.md` | This evidence and implementation report. |

## Tests added

All names below belong to `cargo test -p snapback4 --test expiry_writes`.

| Test | Proof |
| --- | --- |
| `nine_thousand_inserts_have_flat_examined_work_with_and_without_backlog` | 9,000 sequential sends for each unrelated backlog (0, 3,000), all examined counts flat; measured work fits the constant certificate. |
| `each_constraint_is_independent_of_unrelated_rows` | Isolates unique-only, cap-only and both at 9,000 live rows for each backlog. |
| `cli_certifies_keyed_expiry_writes_with_the_actual_sweep_policy` | Real `check --cost --json` returns constant classification and explicit policy. |
| `expired_unique_keys_can_be_reused_and_background_sweep_removes_the_old_row` | Insert, if-absent, unique upsert and by-id upsert reuse expired keys; verifies physical removal after sweep, not unconditional inline cleanup. |
| `secondary_unique_checks_examine_only_their_full_key_collisions` | Exactly two matching expired rows examined across two unique constraints; 3,000 unrelated expired rows remain untouched. |
| `expiry_caps_count_unswept_rows_until_the_sweep_for_table_and_group_caps` | Conservative cap refusal examines zero rows; sweep frees capacity for both cap forms. |
| `same_key_backlog_is_metered_for_insert_if_absent_and_upsert` | 3,000 matching expired siblings fit; 9,000 refuse at examined 8,193 and leave rows/counters unchanged. |
| `hidden_live_collision_and_denied_insert_keep_their_refusals` | Hidden live collision and denied insert remain E_RULE without side effects. |
| `counters_follow_moves_deletes_savepoints_and_rollback_on_both_stores` | Counter transitions and rollback agree in SQLite, memory-device and raw MemoryRows adapters. |
| `memory_reopen_rebuilds_counts_and_schema_reset_discards_them` | Persisted memory images reconstruct counts; reset clears them. |
| `sqlite_reopen_upgrades_legacy_counts_without_changing_generation` | Missing counter table/marker upgrades once, preserving generation and subsequent sweep/restart behavior. |
| `cap_counts_interpret_legacy_images_through_literal_defaults` | Legacy rows missing a later literal-default group field count in their interpreted group through update and delete. |
| `counter_identity_separates_column_names_from_values_without_delimiter_aliases` | Raw schema names and group values cannot alias one another's counters, and a raw authored table/index cannot overwrite the private memory counter namespace. |
| `server_and_both_devices_agree_on_expired_caps_and_unique_reuse_after_reopen` | Server, native SQLite and memory devices agree on cap refusal, then reuse after sweep and streamed deletion; prediction withdrawal restores counter state. |
| `devices_accept_keyed_writes_at_nine_thousand_live_rows_with_both_backlogs` | Native/memory devices and server agree with 9,000 live and 0/3,000 acquired-then-expired rows. |

## Stopped work and concrete counterexample

The trial implementation replaced an expiring unique lookup with a full-key
loop calling `Runner::remove` for each expired hit. This preserved index,
aggregate, asset and partition bookkeeping, but was not disclosure-safe.

Existing reproduction:

```sh
cargo test -p snapback4-sim --test reviews a_never_live_grant_stays_silent_across_watermarks -- --exact
```

1. A membership is unique on `(group, person)` and grants synced `notes`.
2. At clock 150 insert `expired-member` for Alice/group `g` with expiry 100.
   It was never live at a commit boundary; its row/group must remain undisclosed.
3. At clock 160 insert `expired-member-2` for the same key, expiry 120.
4. The trial inline deletion produced, at sequence 3, a `del` exposing
   `expired-member` and a `scope` exposing group `g`. The test failed at
   `reviews.rs:629`, for page limit 1 (the limit 1,000 case has the same issue).

This is an observed counterexample, recorded in `lane-p-suite-3.log`, not a
hypothetical concern. The row store does not retain birth-visibility provenance;
inferring it by scanning partition history inside a keyed write would defeat
the bounded-work requirement. Resolving this needs a reviewed lifetime/provenance
choice from the supervisor. No new unconditional inline cleanup is committed.
Existing by-id replacement and background-sweep behavior are unchanged.

The remaining requirement is reproducible on this branch using the new
`expired_unique_keys_can_be_reused_and_background_sweep_removes_the_old_row`
test: after `add`/`quiet`/`put`, both physical rows remain; only
`sweep_expired(100, 2000)` removes the expired predecessor. At `cap 1`, its
physical occupancy conservatively refuses the new row until swept. The tests
state that behavior explicitly and make no immediate-removal claim.

## Open server/device agreement problem

A further measured counterexample prevents a general server/device agreement
claim for conservative **physical** caps. A fresh snapshot intentionally omits
expired rows; its device therefore cannot reconstruct the server's unswept
physical occupancy from those row images.

Reproduction (both SQLite/native and memory devices):

1. Declare `cap 1 by conversationId` and `expire at .expiresAt` on messages.
2. On the server load `old`, conversation `chat`, ordinal 1, expiry `now - 1`.
3. Acquire a fresh complete snapshot onto a new device. It contains no message.
4. Insert `new`, conversation `chat`, ordinal 2, with null expiry.
5. The server refuses `E_CONSTRAINT` because physical occupancy is 1; both
   devices predict success because local physical occupancy is 0.

`lane-p-cold-counterexample.log` records `prediction_ok=true` and the server's
`E_CONSTRAINT` for each adapter. The temporary probe was removed after capturing
the result, rather than adding a regression that endorses this mismatch.
Server authorization remains authoritative, so the predicted write is rejected
on settlement. The committed server/device tests prove agreement when they
hold the same physical population, and after a sweep's deletion is delivered;
they do not prove agreement for the cold-snapshot case.

The brief permits conservative counts but also asks for server/device agreement.
This case needs the supervisor to decide how devices learn physical occupancy
or when such predictions should defer. Lane P does not invent a new sync
protocol or disable prediction for all expiring capped tables. The maintained
count implementation is reviewable but this portion is incomplete.

## Validation and limits

Final qualification, exact full-suite summary and earlier failure attribution
are appended below. No local Postgres server is available; the adapter receives
a feature compilation check, not a runtime qualification. SQLite server and
native/memory device scenarios execute. No package is released or version bumped.

The shared root volume filled twice while linking the complete inventory.
Only this lane's ignored `snapback4/target` moved to
`/var/cache/expose-build/sb4-intent-lane-p-target-20260924`, with a symlink at its
old location. Full qualification uses `CARGO_INCREMENTAL=0` and the suite's
existing `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` option. No tests are skipped or
weakened for this setting. Node 24.13 is the brief's permitted host deviation.

## Qualification attempts and complete failure attribution

Logs live under `/home/ccheever/sb4-intent/`. No failed run is presented as a
passing qualification. None of these failures is attributed to baseline merely
because it is inconvenient.

| Run | Exact summary | Classification and disposition |
| --- | --- | --- |
| `lane-p-suite-1.log` | `== 3 failure(s) in 301 s` | Wasm byte overrun: ours, measured and handled under the repository ratchet rule. Rust build: environmental ENOSPC, compiler/linker failures before tests. Client failures listed below. |
| `lane-p-suite-2.log` | `== 2 failure(s) in 285 s` | Rust artifact build: environmental ENOSPC, including linker SIGBUS. Client identity/timing failures repeated; both cleared with serial client files in run 3. |
| `lane-p-suite-3.log` | `== 1 failure(s) in 799 s` | Twelve Rust failures from the trial implementation, all ours and listed below. Client tests passed. |
| `lane-p-suite-4.log` | No summary; intentionally stopped with SIGTERM (143). | Interrupted after the audit found legacy default interpretation missing from counter keys, before claiming final qualification. |
| `lane-p-suite-5.log` | No summary; intentionally stopped with SIGTERM (143). | Interrupted to isolate the private memory namespace from raw table names containing NUL/dots; added the adversarial collision regression. |

Run 1 client failures, individually listed. The four codec census failures were
ours: changing the exact schema decoder spelling broke its intentional source
census. Restoring that spelling fixed them. The other failures occurred under
disk exhaustion/concurrent load and cleared without client implementation or
test changes, using the roomy build volume and serial client files. They are
classified environmental/transient; a precise timing cause is not proven for
each. The identity and native-256 tests repeated in run 2.

| Client test | Attribution |
| --- | --- |
| shared logout fences a held online rotation while signed out | environmental/transient; cleared in run 3 |
| W8R1a dev withholds hidden population cuts | environmental/transient; cleared in run 3 |
| W8R1a serve withholds hidden population cuts | environmental/transient; cleared in run 3 |
| W8R1a online remembered uniform continuation and nonuniform cuts survive disconnection | environmental/transient; cleared in run 3 |
| W8R1a native remembered uniform continuation and nonuniform cuts survive disconnection | environmental/transient; cleared in run 3 |
| W8R1a web remembered uniform continuation and nonuniform cuts survive disconnection | environmental/transient; cleared in run 3 |
| W8a online uniform words continue while nonuniform words and meter cuts remain bounded | environmental/transient; cleared in run 3 |
| W8a native uniform words continue while nonuniform words and meter cuts remain bounded | environmental/transient; cleared in run 3 |
| W8a web uniform words continue while nonuniform words and meter cuts remain bounded | environmental/transient; cleared in run 3 |
| W8a dev refuses held queries with a rewrite | environmental/transient; cleared in run 3 |
| W8a serve refuses held queries with a rewrite | environmental/transient; cleared in run 3 |
| W8a native held horizon stays local online, including observe | environmental/transient; cleared in run 3 |
| W8a web held horizon stays local online, including observe | environmental/transient; cleared in run 3 |
| W13b native cursorless incomplete read stays local online | environmental/transient; cleared in run 3 |
| W13b native meter incomplete read stays local online | environmental/transient; cleared in run 3 |
| W13b native horizon and presence use server knowledge only online | environmental/transient; cleared in run 3 |
| W13b web cursorless incomplete read stays local online | environmental/transient; cleared in run 3 |
| W13b web meter incomplete read stays local online | environmental/transient; cleared in run 3 |
| W13b web horizon and presence use server knowledge only online | environmental/transient; cleared in run 3 |
| W13b dev logs a measured cut | environmental/transient; cleared in run 3 |
| W13b serve hides a measured cut | environmental/transient; cleared in run 3 |
| stopped full-release restore preserves its recovery point and stays separate from the original | environmental/transient; cleared in run 3 |
| sync store identity survives a server restart; a live client detects an equal-watermark replacement | environmental/transient; cleared in run 3 |
| native: maximum pending ids (233), cursor batches and every terminal acknowledgement | environmental/transient; cleared in run 3 |
| native: maximum pending ids (256), cursor batches and every terminal acknowledgement | environmental/transient; cleared in run 3 |
| idle polls detect packet silence at 0.5, 5 and 15 seconds on both stores | environmental/transient; cleared in run 3 |
| healthy heartbeat polls, buffered native fetch and browser connectivity hints | environmental/transient; cleared in run 3 |
| web-reachable typed JSON calls all use the codec funnel | ours; decoder spelling restored |
| census kills parse, encoded, MQ components and container regressions | ours; decoder spelling restored |
| sqlite exceptions cannot move into a web function or lose their cfg | ours; decoder spelling restored |
| representation exceptions require the exact sqlite decoder and are consumed once | ours; decoder spelling restored |

Run 3 Rust failures (all **ours**, from the stopped inline-cleanup trial or its
meter integration):

| Test | Cause and disposition |
| --- | --- |
| `a_never_live_grant_stays_silent_across_watermarks` | Actual disclosure counterexample; inline deletion stopped, original assertion preserved. |
| `an_expired_unswept_grant_does_not_hide_its_replacement_interval` | Trial removed row before expected sweep; original behavior restored. |
| `constraints::expired_collisions_are_removed_for_insert_if_absent_and_both_upsert_targets` | New test expected two examinations but the valued upsert also reads the result; trial test replaced with explicit retained/swept behavior. |
| `hidden_filter_work_has_one_wire_and_meter_observation` | Trial metered materialization changed hidden-write observations; removed with unsafe helper. |
| `maintains::recorded_membership::live_replacement_passes_unswept_members_memory` | Trial swept expected retained predecessors; original behavior restored. |
| `maintains::recorded_membership::live_replacement_passes_unswept_members_sqlite` | Trial swept expected retained predecessors; original behavior restored. |
| `prefix_reads::w13c_rule_exists_keeps_one_probe_across_expired_siblings` | Expired-row charging accidentally applied to rule probes; limited to write-target resolution. |
| `review2_hidden_and_absent_worlds_keep_identical_observations` | Trial materialization changed hidden-write heap observations; removed with unsafe helper. |
| `review2_hidden_occupancy_has_bounded_physical_work_and_scratch` | Trial required scan_metered on a wrapper with the safe default refusal; removed with unsafe helper. |
| `round2::expired_authority_witnesses_memory` | Rule-probe charging changed query results; limited to write-target resolution. |
| `round2::expired_authority_witnesses_sqlite` | Rule-probe charging changed query results; limited to write-target resolution. |
| `w3_uniform_page_with_expiring_rule_probe_has_no_population_oracle` | Expired-row charging accidentally changed rule-probe admission; limited to write-target resolution. |

Focused development runs also caught: an invalid hidden-rule fixture using
`sync public` (fixed to `online only`), the incomplete added lookup parameter
(fixed before qualification), and the existing cap test's former live-only
semantics (updated to assert conservative refusal, sweep, then success).
These were ours. No product test was deleted to obtain a green result. A temporary cold-device
probe was run separately to establish the documented open mismatch, then removed;
it was never part of a claimed full-suite qualification.

The provided baseline log reports `== 1 failure(s) in 276 s` and four inherited
Rust failures (`genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`,
`uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`,
`census::authoring_census`, `w9b_why_operation_keeps_residency_and_cost_output`).
They did not recur in run 3; this lane did not change them.

Direct orientation was used because the checkout's `llp-orient` skill link is
unavailable; the required Snapback 4 rules, design, guide and write/expiry code
were read. The final suite uses the unmodified checked-in harness. No external
messages, push or package publication occurred.

## Final artifact and focused checks

- Final web artifact: **1,748,501 B raw / 485,838 B gzip**. Against the inherited
  integration measurement (1,744,842 / 484,967), this is **+3,659 raw / +871 gzip**.
  The existing **486,000 B** budget remains unchanged, with **162 B** headroom.
  The trial's temporary budget increase was discarded with the unsafe helper.
- Final focused expiry suite: **15 passed, 0 failed**, 3.13 s. Both 9,000-insert
  sequences measured **1..1 examined rows**; 0 and 3,000 unrelated expired rows.
- Postgres feature check passed; no Postgres runtime was available.
- Affected authorization/membership device suites passed (81 readauth tests and
  24 recorded-coverage tests); the simulator disclosure review suites retain
  their original assertions and pass after the unsafe trial was removed.
- `ref-check --verbose`: 505 LLP documents, 9,236 references, zero errors and
  zero unchecked references. `git diff --check` passes; all 26 changed/new
  source files remain below 1,500 lines (largest: `engine/read.rs`, 1,366).

Final full-suite command, from `snapback4/`:

```sh
CARGO_INCREMENTAL=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Exact result: **`== 0 failure(s) in 762 s`** (exit 0), recorded in
`/home/ccheever/sb4-intent/lane-p-suite-6.log`. The full Rust inventory passed
in 132 s; all other harness stages passed. Client totals: **1,098 tests,
1,088 passed, 0 failed, 10 skipped**, with the repository's existing skips.
There are **no final-run failures** to attribute to this lane, baseline or
environment. This qualifies the retained implementation and existing tests;
it does not resolve the two explicitly stopped requirements above.

Implementation and evidence are committed separately for review. Both commit
messages carry the requested GPT-6 Astra co-author trailer. Git author identity
was absent on this host, so the commits use a per-command agent identity; no
global Git configuration changed. No push, package publication or version bump.

