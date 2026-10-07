# RS round 1 — close the remaining refusal paths

Date: 2026-10-07. Base: `dbfcff9fa35a3619b23099f3ab3981371146cdaf`.
Branch: `sb4-intent/rs-read-sessions-refusal`. Work stayed on eb1000 in
`/home/ccheever/sb4-intent/lane-rs`. No other host or worktree was used.
Nothing was pushed or published.

The user supplied Grok's READY review and Astra's NOT READY review with three
reproductions under `~/sb4-intent/reviews/rs-r0.astra.evidence/`. The user also
reported that the Darwin fence passed 10/10 on the mini at the round-0 commit.
That is evidence for the prior commit, not a Darwin rerun of this revision.

## F1: PostgreSQL admission after the head-lock wait

The round-0 `PostgresEngine::open` checked version before acquiring the head
lock. `attach` then rechecked only schema/programs. A version-only change while
waiting could therefore pass and install upgrades into an unsupported store.

[Attachment](../../../crates/snapback4-core/src/engine/postgres/mod.rs) now
reads `version,schema,programs` again immediately after `SELECT seq FROM _head
... FOR UPDATE`, before physical upgrades. It checks the version, decodes and
validates the held schema/programs, compares them with the captured backend,
and repeats portable index-key admission under that same writer fence.
Generation/contribution checks remain inside the transaction before commit.

The [concurrent regression](../../../crates/snapback4-core/src/engine/postgres/tests/refusals.rs)
holds the head, starts eight real `PostgresEngine::open` calls, and waits until
`pg_stat_activity` identifies all eight PIDs waiting on that exact head query.
It changes only the version, snapshots all schema definitions and rows, commits
the controller, and requires all eight opens to refuse with the snapshot
unchanged. A paired test runs eight successful simultaneous attachers against
the same missing-column/table legacy shape.

The first test attempt incorrectly combined fixture DDL and `BEGIN` in one
PostgreSQL simple-query batch, retaining the DDL lock and preventing the
attachers from reaching their head query. Separating fixture setup from the
held transaction corrects the test barrier; no production change was needed
for that correction. Both logs are retained.

## F2: refusal must preserve the main file and surviving WAL

[Store opening](../../../crates/snapback4-core/src/store.rs) sets
`SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE` immediately after connecting and before its
first database read. The setting survives every pre-acceptance failure and
connection drop. A validated server attachment or successful activation
restores normal close-time checkpointing. Failure to restore that optional
close behavior retains the conservative setting rather than returning a
refusal after a successful commit.

The [SQLite regression](../../../crates/snapback4-device/tests/schema_capabilities.rs)
leaves committed WAL frames with no connection alive, using no-close-checkpoint
on the fixture writer. It snapshots both files without opening SQLite, refuses
the unsupported version through public `Store::open`, and compares both the
main file and WAL bytes. It asserts that the fixture really contains frames.

The native recovery regressions below also retain committed WAL frames in
their WAL variants, then compare the WAL as well as the main file and complete
schema/row dump after refusal. DELETE-mode controls remain in the matrix.

## F3: native recovery is part of installation

Previously `open_store_mode` committed `install_checked`, then used separate
transactions for capture abandonment and invalid native-cache cleanup. A
send-revision overflow or cleanup error could refuse after physical upgrades
had committed.

[Native opening](../../../crates/snapback4-device/src/device/opening_native.rs)
now supplies a completion callback to
[`Store::install_device_checked_with_finish`](../../../crates/snapback4-core/src/store/activation.rs).
The callback runs after installed metadata is visible and before activation
commits. It sets the initial media format, abandons capture, validates the
send revision, reads and validates the native cache, clears an invalid cache,
and reads the store identity. After commit, construction only moves these
already validated values into the device; it performs no fallible store work.
The native in-memory adapter installs into a candidate and swaps it only after
recovery succeeds. The web opening path is unchanged.

The regression starts without `_effect_steps`, then exercises maximum send
revision, malformed revision, and a trigger that refuses native-cache cleanup.
All refuse without retaining the newly created table or any other schema,
metadata, row, main-file or WAL change. The cleanup case covers the other
formerly fallible post-install transaction, beyond Astra's overflow witness.

## Fixture fidelity and wasm

The [shared fixture module](../../../packages/snapback4/test/helpers/schema-capability-fixtures.mjs)
contains the original Darwin fence's timeline-v2, recorded-attribution and
maintained-column sources, plain predecessors, seed rows and query names.
The Darwin test now imports that module without changing its assertions.

The [Linux fixture tests](../../../packages/snapback4/test/schema-capability-refusals.test.mjs)
compile those same sources using real servers. They retain real seeded rows,
verify each candidate's capability markers, then assert full schema/table/row
and database-byte equality after a current open followed by refused future
adoption. They also test refused opening of a kept unsupported backend with a
missing upgrade table. Every fixture runs in WAL and DELETE modes. These are
shared-source Linux controls, not a substitute claim for executing the actual
published Darwin 0.2.33 binary here.

The full client pool found one extraction error in the original fence's Linux
control: it also uses the plain `ordinary` source directly. Exporting/importing
that binding from the shared module restores the unchanged control assertion.
The original fence, new refusal file and round4 passed their complete rerun
after the full suite: 20 passed, seven explicitly Darwin-only skips.

The first wasm build changed despite native-only behavior: the added native
code changed the web body's structure and embedded Rust panic locations.
The native path now returns before the unchanged web opening body; native-only
memory code sits after the existing web implementation. Source locations that
the wasm embeds are retained. This avoids a web change or budget adjustment.
Final src and dist wasm match the round-0 artifact byte for byte:

`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`

2,135,164 raw / 645,264 gzip bytes; unchanged budget 645,564.

## Verification

All Cargo runs use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and
`CARGO_BUILD_JOBS=8`. PostgreSQL 16.15 used only this worktree's private
socket-only cluster; that cluster is stopped. Node is 24.13.1. The optional
prior-binary control uses the previously integrity-verified Linux 0.4.13 binary.

| Check | Result | Evidence |
|---|---|---|
| Core lib with PostgreSQL feature | 252 passed, 28 labelled ignores | `core-focused.log.gz` |
| Core identity, read sessions, bound sessions, rows, work records, revocation and capability files | 45 passed, 1 labelled ignore | `core-focused.log.gz` |
| Device lib, adoption and both capability files after the final native layout | 80 passed | `device-qualified.log.gz` |
| PostgreSQL, including ignored adapter cases and both eight-attacher regressions | 31 passed, no skips | `postgres-final.log.gz` |
| Ten read-only client files including round4, plus all three shared-source refusal fixtures | 122 passed, no skips | `client-focused.log.gz` |
| Original fence, shared-source Linux refusal file and round4 after the import correction | 20 passed, 7 Darwin-only skips | `fixture-final.log.gz` |
| Final wasm build and byte comparison | Identical to round 0 | `wasm-identical.log.gz`, `wasm.sha256` |
| LLP references | 0 errors, 0 unchecked | `ref-check.log.gz` |
| Full suite | Rust and models passed; one fixture-import failure corrected and rerun above | `full-suite.log.gz` |

The full `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash
snapback4/scripts/test.sh` completed in **1,912 seconds**. Rust's 308 test
binaries / 1,021 executions and doctests passed, along with all build,
typecheck and fixture steps. All 79 serial model tests passed at the default
5,000 session histories per tier and 3,000 online-client sequences. The 339
client files reported 6,601 passes, one failure and 54 labelled skips. The one
failure was the shared-fixture import described above; its complete affected
rerun passed. This is a full run with a corrected affected rerun, not a claim
of a single all-green full run. No tests were removed or disabled, and no
work counts were reduced.

During the full run, native-only code was relocated without changing its
behavior to preserve wasm bytes; its final native device/adoption checks were
rerun and the identical wasm was copied into the client build before the full
client phase. Final src and dist byte comparisons still match the baseline.
Reference validation reports zero errors and zero unchecked references.
JOURNAL append-only, changed source-file limits and diff whitespace checks pass.

LLP 3000.033 §1.3 now explicitly covers retained WAL frames, checkpoint-on-close,
the complete native opening transaction, and version admission under the
PostgreSQL head lock. Its existing fail-closed authority, immutable caps,
principal revocation, logout, no reader trace and SDK no-refresh rules remain.
