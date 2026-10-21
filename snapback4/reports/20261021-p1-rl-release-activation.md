# P1-RL — release and activation on Postgres

Local lane: `/home/ccheever/projects/sb4-pg-p1rl`, `sb4-pg/p1-release`,
base `8beeb79c52`, expo-build-1000, 2026-10-21. One worker; no sub-agents,
clones, other-machine commands, stash, push or publication.

## Delivered scope

Task 1: `3936cad561` — activation facts and preparation, immutable generation
records, catalog, store identity, opening markers, audience epochs/times,
clock facts, scoped timeline counts, typed metadata reads. Backend captures
and dormant inventory records no longer carry SQLite types. Exact backend
and selected-release checks, activation hashes and generation increments use
shared policy. The strict asset relation verifier is reused by activation
and release; inheritance in either direction also refuses.

Task 2: `3a9cf783ea` — typed release event/status access on both adapters;
shared event/revision policy. Existing SQLite opening/tooling delegates to
the contract. Postgres evaluator methods `create_release`, `activate_release`,
`open_selected`, `release_status` reach the implementations. The first
selected release and generation commit together. Program-only successor,
equal-content activation and rollback retain SQLite's generation/revision
meanings. No `serve` or `deploy` wiring.

Task 3: shared contract, signed identity boundaries and observable contention
evidence; the final lane commit contains this report and the qualification fixes.

## Contract and differences

| RFC §9.1 rule | Implementation and evidence |
| --- | --- |
| 1 — NUL | Shared admission refuses new operation/native-digest/item-key NUL before writes. Numeric release ids use typed counters. JSON summaries/items/payloads retain escaped NUL. Postgres table/id metadata lookups return absent for impossible NUL keys. Timeline status lives inside JSON, so NUL there remains a valid stored value; PG streams and decodes text in Rust instead of using `jsonb`, which rejects escaped NUL. Legacy SQLite data reads are not revalidated. Direct preparation/metadata writes bypassing admission remain the documented residual: SQLite can store NUL; PG's existing guard returns terminal E_INPUT. |
| 2 — total ordering | Events order by unique id; event items by path within event; workers by metadata key; streaming images by id within table. Shared cases bind page limits, including a full page followed by a partial/empty page, case-sensitive keys and a NUL-containing cursor. |
| 3 — explicit columns | All new cached queries name columns. A real second-connection ADD COLUMN preserves the cached history reader; attach subsequently continues to require its declared relation shape. |
| 4 — terminal statement errors | The shared duplicate-event-item case errors after partial writes; dropping the owning transaction rolls back event, item and revision on both stores. No caller catches and commits a failed operation. PG retains its server abort and pre-bind poisoning behavior. SQLite's driver itself remains resumable; the port's terminal-error contract requires rollback/drop. |
| 5 — typed arguments | Owned backend/event/item records, typed summaries, unsigned counters/limits; limits clamp to signed i64 max on both adapters. Zero remains zero. Page cursors compare bytes on PG, including NUL, matching SQLite BINARY text ordering. No dialect JSON-array argument parsing. |
| 6 — attach DDL | New PG generation/catalog/history tables install only at fenced attach. Activation/history writers contain no DDL. A held reader snapshot coexists with a successor activation and keeps reading the first backend. SQLite's existing administrative schema/dormant initialization stays at its original activation boundary; no new history operation runs DDL. |
| 7 — observable race | Full release activation calls race on two connections. The shared FenceRace helper waits for SQLite's busy handler or pg_blocking_pids identifying the holder at the `_head` fence before allowing commit. Cases include a generation-changing activation and an equal-content activation, where selection/revision rather than generation fences the loser. Exactly one new selection/event survives. |
| 8 — signed boundaries | Shared history/generation/catalog identities refuse exhaustion before writes: saturation would reuse an identity. Epoch u64 max and i64 min/max times round-trip on both stores. Missing/malformed clock and epoch meanings match SQLite. No lease/time addition or mutable row-count arithmetic is introduced by this family. |
| 9 — locale-independent attach | Structured relation/column/constraint/index checks use the `C` collation oid; no rendered index/locale spelling comparisons. New relations refuse UNLOGGED/partition/inherited tables, row security, rewrite rules, triggers, defaults, deferrable/extra keys and extra constraint types. Metadata pattern matching folds ASCII only, matching SQLite LIKE even on a UTF-8 locale. Default and en_US.utf8 cluster results are below. |

Additional cases share first-generation adoption, independent selected reopen,
restart after closing all engine connections, second generation, equal-content
revision, rollback generation, wrong selected release, stale revision,
exact-byte backend mismatch, scratch cleanup, all opening markers, corrupt
later-row streaming, retirement and timeline counts (including JSON NUL).
Postgres cases emit named SKIP messages without SNAPBACK4_EVAL_POSTGRES;
those returns are excluded from the real-database evidence here.

Dialect resolutions beyond the table: PG rows/indexes retain textual table
names; `_catalog` records the same stable name/ordinal facts as SQLite, and
the adapter maps storage by name. PG stores generation/release counters as
BIGINT and metadata as text; shared history counter validation bounds both.
For event ids, both adapters allocate MAX(id)+1 through a shared checked identity helper
while holding their writer fence. Ordinary SQLite ids are unchanged; at the
signed limit SQLite now refuses instead of falling back to a random rowid.
Catalog ordinals also use shared checked allocation, replacing SQLite
overflow/panic at the boundary. Both preserve monotone identity and event
ordering for the admitted history. Audit and generation-record timestamps
use wall time, independently of the caller's application clock. SQL pattern predicates use explicit ASCII
folding to preserve SQLite's matching. PG history JSON is TEXT, never JSONB.

## Verification

| Check | Result |
| --- | --- |
| `cargo test -p snapback4-core --no-fail-fast` | Pass across all targets; five existing ignores. |
| `cargo check -p snapback4-core --no-default-features` | Pass. |
| Host store-port / committer ratchets | 7 + 3 pass; no allowance raised. |
| Guide `every_emitted_code_is_explained` | 1 pass. |
| WASM codec census, Node 24.13.1 | 27 pass. |
| Default Postgres script | 58 experiment tests, 170 core tests, 19 corpus harness tests pass. Serialized Postgres corpus: 207 passed, 88 named skips. |
| `en_US.utf8` Postgres script | Same counts, all pass; real locale confirmed available by `locale -a`. |
| Final affected SQLite release cases | 18 pass after the final history forwarding and identity guards. |
| Final fresh-cluster family cases | 15 pass: 9 Postgres + 6 SQLite, with no absent-database returns. Includes executed program after reopen/rollback and event identity exhaustion. |
| Required Clippy command | Only inherited `while_immutable_condition` at `engine/read.rs:780` and `never_loop` at `engine/row_views.rs:1014`; both files byte-identical to base `8beeb79c52`. |
| Clippy with those two lints allowed on its command line | Pass with warnings; all tests checked. No source lint setting changed. |
| Root `./ref-check` and whitespace | Pass; rerun after the final document update. |

The complete core run precedes the final mechanical history forwarding and
signed identity guard delta. The final 18 affected release cases, 15 family
cases and full test compilation/Clippy cover that delta; unrelated large
matrices were not repeated. The per-locale scripts include the nine new
Postgres cases within the 170-test total. The 88 serialized skips keep their
existing named feature reasons and are not counted as passes.

All Cargo commands use only this checkout's `snapback4/target`, incremental
disabled, dev/test debug line-tables-only, and 8 build jobs. Disk space is
checked throughout and remains far above the 30 GiB stop threshold (lowest
sample approximately 180 GiB). Logs are task-owned `/tmp/p1rl-*.log` files;
summary records are `/tmp/p1rl-final-results.json` and
`/tmp/p1rl-verified-results.json`. The first summary retains the preliminary
script failures; the `*-verified.log` runs are the passing complete scripts.

All six owned clusters were independently rechecked: `pg_ctl status` = 3
and no `postmaster.pid` in each data directory. Their retained directories:
`/tmp/sb4-pg-eval.Co1xPS`, `/tmp/sb4-pg-eval.JMfBl0`,
`/tmp/sb4-pg-eval.qbtQ0v`, `/tmp/sb4-pg-eval.CLL07G`,
`/tmp/sb4-pg-eval.zHakjc`, `/tmp/sb4-pg-p1rl-final-4nx5hsl9`.
The first three belong to preliminary script attempts, the next two to the
passing default/locale scripts, and the last to final family qualification.
No cluster owned by another session was stopped.

A preliminary run found two fixture/prerequisite issues, both corrected:
new SQLite fixtures need a private parent rather than `/tmp` itself; the
standalone Postgres experiment lockfile contained one obsolete device
`rusqlite` edge. Its executable also retained five private `.conn()` calls
from before S8. Three redundant FULL pragma writes are removed (Store::open
already configures FULL), and two version queries use the evaluation
adapter's typed library-version read under `evaluation-support`. Offline metadata resolution removes only that line, with
no dependency version changes. Extracted PostgreSQL packages use
SNAPBACK4_PG_SHARE pointing to the pg16 share directory in addition to the
requested PATH/LD_LIBRARY_PATH/TMPDIR.

## S10d handoff and limits

The adapters are reachable through the evaluator's explicit release methods.
The ordinary `Engine`/HTTP host still owns SQLite. The supplied base has
separate family shape verifiers; this lane factors the strict asset verifier
into `engine/postgres/shape.rs` for reuse. The parallel foundation guard
work needs normal integration; this lane did not inspect another checkout. S10a–c must forward the
neutral traits/records/typed metadata and retain the member-safe tail/ledger
work; no implicit SQLite fallback is supplied by this lane.

The minimal release profile accepts an unchanged prepared schema and changed
programs/native metadata. Every schema-changing release activation refuses
before preparation writes. Full dormant retention/restoration, row projection,
new index/constraint validation, Following launch and general evolution need
their own adapters before widening that profile. `enable_dormant` on the PG
preparation is the empty-profile preparation only; the explicit activation
admission is its guard. Empty inventory describes the actual admitted store,
not a simulated dormant population. Timed publication remains refused;
clock/epoch facts and the empty-publication marker do not qualify its runner.

S10d still must resolve StoreConfig, prepare immutable local release source
and matching compiled host metadata, bind logical store identity and selected
release, compare source/host bytes against the persisted backend at reopen,
wire deploy/serve and gate unadmitted runners. Before enabling a listener it
also needs the production owner token/lease, tagged fenced transactions,
uncancellable/ambiguous COMMIT handling, and the worker completion ledger
binding. History now provides persisted facts for ambiguity resolution;
this evaluator does not implement a deployment retry/cleanup protocol.
BlobStore, artifact digests, HA and production serving are outside this lane.

Known limits: restart coverage closes every engine connection and reopens a
new one; it is not a database crash/failover experiment. There is no known
remaining failure in the tested minimal adapter profile. The unimplemented
host/evolution layers and direct-Rust NUL bypass difference above remain
explicitly unqualified.
