# P0-S6: core release, schema, activation, time and typed metadata

Base: `98de657098b878b7f9a9934e24a54386a72cbb46` (`sb4-pg/main-mirror`).
Branch: `sb4-pg/p0-s6`. No host source, Postgres adapter, P0-S4c or P0-S5
source changes. No push.

`activation.rs` adds plain backend records and crate-private access traits;
`store/activation_access.rs` implements opening reads, activation preparation,
restoration metadata, streaming retirement and operator counts. Policy and
refusal order stay in the engine. `store/opening.rs` retains the exact backend
comparison. All original SQL statement literals remain present unchanged.

`metadata.rs` defines crate-private reader/writer traits and typed schema,
restoration and development key selectors. `store/metadata.rs` implements them
and exposes typed Store/Tx forwarding methods for the independent host migration.
Values stay textual: missing, malformed and empty values retain their existing
caller-specific interpretations. Generic Store reads retain ownership checks.
Time access extends the existing `store/time_audience.rs` clock family.

`store/dev_reset.rs` owns the original reset transaction. Clock pinning, asset
inventory, schedule priming and commit/seeding callbacks run at their original
statement boundaries. Schedule writes now use P0-S4b's `JobTransaction` methods.
The raw `_assets` inventory is deliberately retained in the engine callback for
P0-S5; that lane can replace it without changing reset order. Reset's ephemeral
rebind and continuation clearing remain after commit.

Shared contract cases cover worker revision fences, independent metadata key
families, textual malformed values, early-stop retirement streaming and retired
names. SQLite invokes them on store and transaction handles as applicable;
metadata rollback is also checked. Existing reset, release, schema and timeline
suites exercise the public behavior. New traits explicitly mark Postgres as P1.

## Remaining generic metadata callers

This is a source census of `.meta(...)` / `.set_meta(...)` calls, including tests.
Direct SQL in the pending outbox lane is outside this generic-call census.
Generic access is intentionally still available. The two non-adapter core calls
are `engine/asset_uploads.rs` (P0-S5); all other core calls are adapter internals
or adapter tests. Host migration belongs to S7 and subsequent host lanes.

### Core

- `engine/asset_uploads.rs`: 191, 259.
- `store/activation.rs`: 64, 99, 205, 219, 223, 226, 236, 253, 393, 402, 406, 460, 462, 467, 468, 478.
- `store/activation_access.rs`: 32, 35, 38, 50, 91, 94, 97, 103, 107.
- `store/adoption_estimate.rs`: 83, 86, 87.
- `store/adoption_tests/retirement.rs`: 124, 326, 361.
- `store/adoption_tests.rs`: 171, 377, 385, 391, 394, 398, 411, 426, 437.
- `store/backfill_tests.rs`: 13, 61, 679.
- `store/backfills.rs`: 35, 160, 189, 341, 641.
- `store/dormant.rs`: 45, 501, 605, 630.
- `store/dormant_tests.rs`: 34, 228, 275, 326, 498, 507, 766, 827, 994, 1175, 1177.
- `store/jobs.rs`: 169, 173, 203, 209.
- `store/live_activation.rs`: 86, 94.
- `store/metadata.rs`: 36, 72, 107.
- `store/narrowed.rs`: 200, 201, 204, 205, 208.
- `store/partition.rs`: 52, 61.
- `store/release_history.rs`: 208, 211, 224, 229, 231, 291, 291, 291, 291, 302, 331.
- `store/time_audience.rs`: 22, 34, 215, 222.
- `store.rs`: 1041.

### Host

- `assets.rs`: 73, 111, 317, 337, 352, 379.
- `dev_clock.rs`: 115.
- `dev_replay.rs`: 24, 30, 31, 33.
- `dev_worker.rs`: 401, 785.
- `native.rs`: 415.
- `project.rs`: 271, 282.
- `release_control.rs`: 474.
- `serve.rs`: 171, 814, 1060.
- `serve_adoption.rs`: 138.
- `serve_ephemeral.rs`: 15, 79, 253, 273.
- `serve_maintenance.rs`: 366, 408.
- `serve_start.rs`: 53, 168, 174, 198.
- `serve_tests.rs`: 46.
- `serve_token.rs`: 113.
- `store_owner.rs`: 195.
- `store_owner_tests.rs`: 180, 181, 182, 183.
- `verbs/adoption.rs`: 103.
- `verbs/releases.rs`: 121, 138, 656.
- `verbs/sql_catalog.rs`: 425, 431.
- `verbs/staging.rs`: 16, 18, 23.
- `verbs/witness/smoke.rs`: 203, 303.
- `verbs.rs`: 1044, 1046, 1065, 1066, 1096.

The existing `engine/postgres/` adapter is excluded from this census and
unchanged. SQL-local metadata inside adapters also remains adapter-owned.

### Other workspace metadata custody

`snapback4-device/src/sqlite.rs:51,54,84` forwards `Store::meta`,
`Store::set_meta`, and `Tx::set_meta` into the independent `DeviceStore` /
`DeviceTx` metadata contract. Those forwarders are unchanged; the later generic
API privacy slice must also account for this device boundary.

The following additional lexical matches include that independent device
metadata interface and test/harness callers. They are outside the migrated
server-core production scope; this list does not classify every method-name
match as a call to the core Store's generic API.

- `snapback4/tests/check.rs`: 555, 560, 589, 745, 1028, 1032.
- `snapback4/tests/column_commit.rs`: 62.
- `snapback4/tests/device_handshake/mod.rs`: 62, 64, 66.
- `snapback4/tests/doctor/mod.rs`: 20.
- `snapback4/tests/expiry_writes/stores.rs`: 189.
- `snapback4/tests/lifecycle.rs`: 805, 815.
- `snapback4/tests/replay.rs`: 61, 204, 221, 235, 236, 237, 243, 258, 259, 275, 284, 294.
- `snapback4/tests/serve_adoption/worker.rs`: 163, 171, 219, 266.
- `snapback4/tests/serve_ephemeral/mod.rs`: 211.
- `snapback4/tests/serve_refusals/mod.rs`: 142.
- `snapback4/tests/serve_release/mod.rs`: 117, 157, 279, 590.
- `snapback4/tests/serve_stage/mod.rs`: 134.
- `snapback4/tests/serve_sync/mod.rs`: 33, 118, 149.
- `snapback4/tests/timeline/delivery_wire.rs`: 6.
- `snapback4-core/tests/dev_reset.rs`: 68, 70, 75, 103, 115, 119.
- `snapback4-core/tests/effect_policy.rs`: 28, 36, 157, 163, 327.
- `snapback4-core/tests/ephemeral.rs`: 66.
- `snapback4-core/tests/job_time_audiences.rs`: 98, 104, 162.
- `snapback4-core/tests/read_sessions.rs`: 57, 162, 186.
- `snapback4-core/tests/refused_open.rs`: 103, 106, 110, 317, 346.
- `snapback4-core/tests/rows.rs`: 181.
- `snapback4-core/tests/time_audiences.rs`: 677, 870.
- `snapback4-device/src/call.rs`: 113, 247, 249.
- `snapback4-device/src/device/boundary.rs`: 33, 51, 51, 92.
- `snapback4-device/src/device/deferred/recording.rs`: 54, 57, 103, 104, 109, 110, 111, 113, 117, 135.
- `snapback4-device/src/device/deferred.rs`: 21, 25, 51, 81, 142, 143, 145, 148, 149, 157.
- `snapback4-device/src/device/delivery.rs`: 30, 41, 43, 181, 195, 209, 214, 218, 233, 235, 238, 269.
- `snapback4-device/src/device/expiry_clock.rs`: 7, 14.
- `snapback4-device/src/device/history.rs`: 18, 74.
- `snapback4-device/src/device/media.rs`: 23, 70, 71, 115, 128, 132, 134.
- `snapback4-device/src/device/opening_native.rs`: 11, 13, 14, 15, 27.
- `snapback4-device/src/device/opening_tests.rs`: 9, 28, 35, 36.
- `snapback4-device/src/device/predictions.rs`: 28, 43, 168, 192, 258, 262, 264, 295, 300, 316, 390, 390.
- `snapback4-device/src/device/publication_round5.rs`: 12, 13, 14, 15, 36, 56.
- `snapback4-device/src/device/publication_round6.rs`: 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 30, 31, 32, 35.
- `snapback4-device/src/device/publication_round7.rs`: 7, 8, 9, 18, 21, 24, 25, 37, 38, 39, 40, 41, 42, 43, 47, 48, 71, 88, 89, 102, 103, 104, 105.
- `snapback4-device/src/device/publication_tests.rs`: 11, 17, 18, 19, 20, 21, 22, 23, 24, 25, 33, 39, 57, 59, 102, 130, 133, 146, 169, 174, 177, 201, 207, 208, 209.
- `snapback4-device/src/device/recorded.rs`: 72, 80, 98, 103, 108.
- `snapback4-device/src/device/search.rs`: 45, 56, 125.
- `snapback4-device/src/device/snapshot.rs`: 63, 135, 141.
- `snapback4-device/src/device/store_identity.rs`: 7, 19, 29, 44, 49, 49, 71, 88, 89, 93, 111, 116, 117, 129, 129, 136, 157, 158, 164, 172, 174, 174, 207, 228, 238.
- `snapback4-device/src/device/upload.rs`: 25, 81, 140, 153.
- `snapback4-device/src/device.rs`: 298, 363, 373, 381, 388, 391, 392, 433, 465, 494, 516, 519, 520, 521, 541, 573, 576, 577, 578, 614, 616, 617, 619, 660, 677, 684, 687, 689, 689, 719, 720, 721, 725, 728, 729, 729, 729, 729, 743, 746, 749, 800, 848, 851, 854, 855, 856, 858, 875, 876, 877, 879, 892, 895, 931, 939, 947, 952, 970, 970, 1117, 1122, 1137, 1169, 1192, 1243, 1270, 1274.
- `snapback4-device/src/memory.rs`: 347.
- `snapback4-device/src/memory_server.rs`: 108, 113, 114.
- `snapback4-device/src/sqlite.rs`: 41, 51, 54, 84, 101.
- `snapback4-device/src/store.rs`: 128, 129.
- `snapback4-device/tests/asset_lists.rs`: 97, 100, 104, 107, 175, 181, 194, 263.
- `snapback4-device/tests/background_durability.rs`: 36, 64, 100.
- `snapback4-device/tests/codec/old_store.rs`: 145.
- `snapback4-device/tests/expiring_counts.rs`: 231, 272.
- `snapback4-device/tests/expiring_counts_upgrade.rs`: 13, 14, 98.
- `snapback4-device/tests/expiring_mutations/counted.rs`: 12, 13, 51, 52.
- `snapback4-device/tests/expiring_mutations.rs`: 41, 42.
- `snapback4-device/tests/maintains/recorded.rs`: 108, 119.
- `snapback4-device/tests/maintains/recorded_membership.rs`: 86, 102, 152.
- `snapback4-device/tests/native.rs`: 20.
- `snapback4-device/tests/native_reads.rs`: 42, 45, 225, 226, 227, 276.
- `snapback4-device/tests/read_through.rs`: 179.
- `snapback4-device/tests/readauth/regressions.rs`: 94.
- `snapback4-device/tests/readauth/round2.rs`: 176, 246.
- `snapback4-device/tests/repair_b/lifecycle.rs`: 23, 25, 56, 73, 107.
- `snapback4-device/tests/repair_b/round5.rs`: 149, 153, 155, 157, 159.
- `snapback4-device/tests/repair_b/round6.rs`: 56, 58, 111.
- `snapback4-device/tests/repair_b/round7.rs`: 113, 138, 147, 151.
- `snapback4-device/tests/repair_b/round8.rs`: 161, 322, 360.
- `snapback4-device/tests/repair_b.rs`: 303, 325, 330, 410, 411, 434, 440, 456, 460, 467.
- `snapback4-device/tests/repair_b_boundaries.rs`: 87, 87, 131, 132, 140, 153, 154.
- `snapback4-device/tests/retained_release.rs`: 201, 257.
- `snapback4-device/tests/schema_capabilities.rs`: 115, 144, 145, 158.
- `snapback4-device/tests/schema_capabilities_legacy.rs`: 17, 19.
- `snapback4-device/tests/server_clock.rs`: 21, 23, 40, 43, 46, 51, 63, 68, 89, 105, 108, 110, 112, 118.
- `snapback4-device/tests/store_reset/mod.rs`: 74, 88, 119, 165, 181, 195, 214, 242, 275, 289, 295.
- `snapback4-device/tests/sync_windows.rs`: 95, 110, 115, 122.
- `snapback4-device/tests/timeline/round1.rs`: 104.
- `snapback4-device/tests/unread_range/counted.rs`: 12, 13, 51, 52.
- `snapback4-device/tests/upload_receipts.rs`: 20, 24, 25, 26, 30.
- `snapback4-device/tests/w13g_probe.rs`: 68, 358, 487.
- `snapback4-device/tests/w13g_review/counting.rs`: 13, 14, 32, 33.
- `snapback4-device/tests/write_authority.rs`: 63, 82, 124, 271.
- `snapback4-difftest/src/devices.rs`: 173.
- `snapback4-lang/tests/clique_03/transport.rs`: 15, 37.
- `snapback4-lang/tests/declarative_receipts/prediction_counted.rs`: 12, 13, 51, 52.
- `snapback4-lang/tests/declarative_receipts/prediction_round1.rs`: 216, 217, 221.
- `snapback4-lang/tests/declarative_receipts/prediction_round2.rs`: 117, 133.
- `snapback4-lang/tests/derived_maintains/disclosure.rs`: 14, 24.
- `snapback4-lang/tests/fixtures/rp-predecessor/generate.rs`: 21.
- `snapback4-lang/tests/following_atomic_launch.rs`: 243.
- `snapback4-lang/tests/guide/intent.rs`: 121.
- `snapback4-lang/tests/reservation_app_headroom/profile_upgrade.rs`: 12, 13, 96.
- `snapback4-sim/tests/work_intent.rs`: 195, 202.

## Validation

- Ratchet update: passed, 5 tests. Production 194 → 168; tests 103 → 103;
  combined 297 → 271. Only the production allowlist changes.
- Required Clippy command: fails on `clippy::while_immutable_condition` at
  `engine/read.rs:780` and `clippy::never_loop` at `engine/row_views.rs:1010`.
  The exact base `98de657098b878b7f9a9934e24a54386a72cbb46` reproduces both
  with the same command in `/tmp/sb4-p0-s6-base-98de657`. The 205 core warning
  messages/counts match the base; no new warning messages or counts.
- Supplemental `cargo check -p snapback4-core --no-default-features`: passed.
- `./ref-check --verbose`: passed (564 LLP documents, 11,502 references).
- No `scripts/test.sh`, push, sub-agents, stash, clone or remote-machine work.

The first host attempt stopped in `clock`: `advance_drains_expiry_across_multiple_bounded_sweeps`
hit its existing 30-second socket read timeout, and
`kit3_large_clock_report_uses_complete_http_and_runnable_no_argument_commands`
failed its output-length assertion. The exact-base clock target passed all 45
tests, so these are not classified as pre-existing failures. The lane's complete
`--no-fail-fast` rerun also passes all 45 clock tests with unchanged bounds.
The initial host attempt overlapped core compilation and the long core tests;
no causal claim is made from that overlap.

- `cargo test -p snapback4-core`: passed, including all integration targets and
  doctests; the unit target passed 451 tests with 3 existing ignored tests.
- `cargo test -p snapback4 --no-fail-fast`: passed every target, including all
  45 clock tests and the normal ratchet run. The initial required command was
  `cargo test -p snapback4`; the rerun used `--no-fail-fast` to cover all targets
  after its clock-target failure.
- Final `cargo build -p snapback4`: passed.

The first core attempt found a new test-fixture setup error: intentionally
changing `generation` left the fixture owner's captured identity stale before
opening a transaction. The fixture now captures that identity before the
transaction. This was corrected locally, not classified as pre-existing.

No unresolved design uncertainty. P0-S5's retained asset callback and generic
host callers are the remaining integration seams.
