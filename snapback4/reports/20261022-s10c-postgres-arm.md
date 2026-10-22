# S10c — the Postgres arm of the common engine

Lane `sb4-pg/s10c`, base `ad87e0ddb3`, worktree
`/home/ccheever/projects/sb4-s10a` on expo-build-450a. Local commits only;
no push, stash, other worktree or shared scale-cluster operation.

The governing scope is [store-port RFC §3.4](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores),
its revision-2 panel disposition, §5 and §9.1, and the
[S10 census](20261021-s10-engine-census.md). The
[S10a](20261021-s10a-sqlite-store-handles.md) and
[S10b](20261021-s10b-semantic-store-boundary.md) boundaries remain in force.

`Engine` owns `AnyStore`; its Postgres arm owns a scoped adapter handle.
`AnyTx` and `ReadSnapshot` dispatch the landed family traits, including
prefetch, metered scans, sequences, audience facts, placement and receipts.
`AnyPreparation` preserves the activation transaction's two borrows;
inspection and external steps explicitly refuse their unavailable operations.
Shared-receiver composites use a checked outer borrow and the existing
adapter contracts. Concrete enum payload declarations live in `store/port/handles.rs`, with the
public exports unchanged. No driver or owning-handle bridge is added to
`MemberTx`; the ratchet and census retain their existing scopes and allowances.

Opening defers namespace creation until admission. Physical foundation and
family initialization, the shared semantic activation builder, metadata,
backend publication and construction facts share one solo transaction.
Persisted opening checks the selected release and backend before committing
upgrades. Reader factories retain the connection settings and validate store
identity and backend in coherent snapshots; detached handles are read-only
and perform no write upgrades. Opening validates the existing portable index-key bound. Schema evolution
beyond the initial identical schema profile refuses with `release-activation`.

The internal library constructors retain the evaluation namespace convention.
There is no public store selector, `serve`/`deploy` change, owner lease, HA or
blob-storage claim. K0 producer routing and production single-member behavior
are unchanged. `PostgresEngine` remains the independent evaluation oracle.

## Admission and refusals

The initial profile admits ordinary queries, identified data mutations,
receipt replay/id binding, bearer-session resolution/logout, and process-local
ephemeral hubs. Normal shared validation still applies. Exclusions are checked
before initialization or activation writes, and again on persisted open.

| Exclusion | Stable family |
| --- | --- |
| Union sync | `union-sync` |
| `not before` / timed publication | `time-publication` |
| Asset columns or asset arguments; asset bytes | `assets` |
| Jobs | `jobs` |
| Actions | `actions` |
| Routes | `routes` |
| Schedules | `schedules` |
| Native programs | `native` |
| Row-keyed views requiring a recount runner | `view-recount` |
| The evaluator's rejected maintained/private-column shapes | `maintained-columns` |

Additional unavailable semantic boundaries use `opening`, `release-activation`,
`evolution`, `following-history`, `retained-authority`, `seed-evolution`, `dev-reset`,
`steps`, `inspection`, `backup`, `ownership`, `connection-policy` and
`memory-fork`. Each refusal carries `E_STORE_UNSUPPORTED` and its family;
operator string/inspection envelopes retain that code. Implemented family
contracts do not admit their corresponding background producers.

Asset capability access is fallible, and byte-location resolution refuses
before filesystem work. Untimed and asset-free shared operations do not
request those families. Direct calls to unsupported time publication or
asset-column operations still refuse. Audience epochs use actual metadata;
placement uses the initialized P1-AS ledger. A runtime capability refusal
aborts the member without consuming an operation id or storing a failed
program receipt.

The landed change-evidence adapter returns explicit unknown. The tail does
not qualify per-commit evidence. Certified changes and sync remain excluded
from S10d's passed denominator; absent evidence never becomes `preserved: []`.

## Tail and savepoints

`execute` never flushes a tail. `record_commit` refuses an occupied slot.
A member's tail flushes before `RELEASE member`; only successful completion
updates the cached head and clears the slot. Receipts use SQLite's
insert-then-bind protocol and finish within that frame. Shared effect
admission buffers into the same CTE, including presence and explicit release
facts. An orphan tail refuses without discarding effects.

Savepoints snapshot tail and head bookkeeping. Rollback restores that state
and clears speculative row-cache answers; nested frames follow the same
rule. A terminal pre-bind NUL refusal stays terminal across attempted
savepoint recovery. A SQL tail-flush failure can still roll back its member.

Real-Postgres tests exercise two facade members in one physical transaction:
member two observes member one's head, receipt and metadata, allocates the
successor, and explicitly rolls back or errors. Member one alone survives;
a later commit gets the contiguous successor. Further cases cover duplicate
log-key flush failure, occupied slots, nested rollback/cache invalidation,
terminal NUL, and orphan effects. Effect staging makes no driver calls for
1, 8 or 16 effects; completion is one CTE execution plus savepoint release
(with one additional cold prepare on the first member).

The facade property is in [members.rs](../crates/snapback4-core/src/engine/postgres/tests/members.rs);
completion, cache and call-count regressions are in
[unified_tail.rs](../crates/snapback4-core/src/engine/postgres/tests/unified_tail.rs).

## Evidence and qualification

The [in-process HTTP witness](../crates/snapback4/tests/serve_postgres/mod.rs)
uses the unified engine and a real private Postgres
cluster. It passes guest bearer identity, an identified write, replay without
re-execution, id-reuse refusal, query data/head/store identity, failed receipt
replay, unknown preservation, logout and subsequent token rejection. This is
the existing HTTP host harness, not a public CLI or background-worker witness.

The [three-store oracles](../crates/snapback4-core/src/engine/postgres/tests/oracles.rs)
run SQLite/common Postgres/evaluator Postgres
with prefetch off and on. Each mode compares 24 writes, 24 replays, 48 reads
and 6 rolled-back refusals, including reply data, logical meters, completion,
cursors, rows, logs and ledger. The C1 derived-page witness uses the existing
bound: the small page is 20 warmed calls off / 23 on in **both** Postgres
engines, with 8 marked reads and equal outcomes/meters. The richer existing
evaluator fixture also runs through all three stores, covering rules, defaults,
aggregate maintenance, paged cursors, effects, rollback and replay in both modes.
The retained evaluator's
larger witness remains 68 off / 8 on. Its 7,418 query and 19,265 write precharge
positions still match. No relaxed allowance or universal speedup is claimed.

Transcripts, exit statuses, process records and cluster stop receipts live
under `/tmp/s10c-checks`. Full SQLite runs are `core.log`, `host.log` and
`device.log`; repaired/final builds use the `final-` prefix. The current
Postgres stages are `final-pg-families`, `final-pg-member`, `final-pg-handles`
and `final-pg-witness`, with independently checked shutdown in
`all-clusters-final-stop.json`. The default/locale script transcripts and
both isolated `40001` reruns are retained separately. No all-green exit is
claimed for either historical full Postgres script invocation.

| Check | Result |
| --- | --- |
| Binary build | Pass, including the final rerun |
| Production host with internal Postgres feature (`cargo check`) | Pass |
| Core no-default-features | Pass, including the final rerun |
| Device web/wasm no-default-features | Pass, including the final rerun |
| Full SQLite core suite | **1,042 passed / 0 failed / 5 ignored** |
| Full SQLite host suite | **1,409 passed / 2 failed / 15 ignored**; isolated reruns below |
| Full SQLite device suite | **1,573 passed / 0 failed / 4 ignored** |
| Ratchets and concrete-handle census | **16 passed**, no allowance changes |
| Compiled handle guards | **1 passed** in each of the default and Postgres builds |
| Guide emitted-code coverage | **1 passed**; no new error codes |
| Wasm codec census | **27 passed** |
| Postgres script default | **Nonzero**; 204 family/overlap + 2 member + 19 corpus pass; retained 40001 and metadata issue below |
| Postgres script en_US.utf8 | **Nonzero**; 58 evaluator + 206 family/overlap + 2 member + 19 corpus + 1 compiled guard pass; corrected HTTP witness passes alone |
| Final scoped Postgres rerun | **208 family/oracle + 2 member + 1 compiled guard + 1 HTTP passed** |
| Portable-key opening refusal | **1 passed**, isolated after the broad Postgres run |
| Internal HTTP host | **1 passed**, including final rerun (1.24 s) after correcting its fixture |
| Root ref-check | Pass: 564 LLPs / 11,676 refs / 0 errors / 0 unchecked |

The full host failures were the inherited
`advance_drains_expiry_across_multiple_bounded_sweeps` socket timeout
(`WouldBlock`) and the store-port lexical ratchet matching the three qualified
`engine::postgres` enum payload paths as driver sites. The clock case passes
unchanged in isolation (5.11 s). The concrete payload declarations now live in
the existing adapter directory; the public handles and the ratchet's zero
production allowance remain unchanged. The exact failed source scan passes unchanged (0.29 s), and all seven
compiled store-port ratchet tests pass. The combined ratchet/census rerun is
recorded above. All three supplied baseline cases passed in the full host run.

The default-`C` evaluator's existing four-writer test exhausted its serialization
retry budget (`40001`); two real isolated reruns did the same. The same unchanged
case passes in the locale run (65 increments in each mode, no losses, 114
retries). The default standalone experiment command stopped after its failing
conformance target; the script continued the main family/member/corpus stages. The locale run passes every
experimental target. Neither the workload nor its retry policy was changed.

Switching the standalone evaluator and workspace graphs in the required shared
target reproduced S10a/S10b's duplicate-crate metadata problem (`serde`/core
traits from different crate instances). After no standalone compilation
remained, only the lane's generated core/lang/device rlib/rmeta artifacts were
removed and rebuilt; the final Postgres host and compiled guards then compiled.
The HTTP fixture initially omitted bearer headers on `/probe`, and originally
used `head` instead of the wire's `seq`; those fixture mistakes were corrected,
and the isolated full witness passes without a product workaround.

The locale script's default 60-second stop wait expired during a large prior
checkpoint. The owned postmaster finished stopping a few seconds later and was
independently confirmed stopped. The script now waits up to 180 seconds for its
own cluster. The isolated witness reused that already-stopped script-created
cluster and confirmed its second shutdown with this bound. All clusters started
by this lane were independently confirmed stopped (`pg_ctl status=3`, no
`postmaster.pid`); the shared port 55440 was never touched. The private data
directories are retained for inspection:
`o8Dd9g`, `uXtFkV`, `X41NzY`, `P3fy2X` under `/tmp/sb4-pg-eval.*`.

All Cargo commands use this lane's own `snapback4/target` and ten build jobs.
Inactive finalized pre-task incremental caches were reclaimed under their locks;
completed/inactive generated test executables were also reclaimed after excluding
mapped processes. The metadata repair above removed generated lane libraries.
No source, third-party cache, other target or shared cluster was removed. The
20 GiB stop threshold was never reached.

Building commits: `3d848a5d83` (arm/refusals), `6048732718` (concrete SQLite
fixtures), `8b686eebbc` (admission/opening), `15c8885a6c` (opening atomicity and
untimed bookkeeping), `c104f6b1e6` (member tail), `c90300717a` (portable opening
key bound), `603afe4154` (HTTP/family/oracle witnesses and adapter-owned
handle declarations). Final broad-suite results are recorded in the separate
qualification commit carrying this report.
