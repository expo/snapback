# Census completeness audit: SQLite side holds; the non-SQL side is NOT complete

Status: Open — the SQLite census is safe to build a closure claim on; the non-SQL census is not
Created: 2026-08-21
Related: issues/shelved/20260821-unguarded-durable-writes-admission-fence.md,
issues/shelved/20260821-nonsql-durable-effects-unguarded.md,
issues/shelved/20260821-authorized-effect-remedy-classification.md,
issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md

## Why this audit exists

The entire remediation program inherits the coverage of one sink-first census. If that census is
incomplete, the program ends with a false sense of closure — worse than an acknowledged gap. So an
independent auditor was asked to build its own sink inventory from the storage layer outward and
diff it against the census, rather than starting from the census and confirming it.

## Result: SQLite is source-complete

The independent enumeration arrived at the same 22 operation families. No unenumerated,
caller-reachable, unguarded SQLite sink was found.

The census is source-complete for production SQLite logical mutations, raw-SQL commits,
write-capable PRAGMAs, SQLite backup destinations, bare-`Connection` helpers, and internally
opened SQLite writers visible in the reviewed source.

Stated boundary: this is a source census, not compiler-enforced effect analysis. Dynamically
generated or macro-hidden SQL remains an INFERRED boundary — already acknowledged by the original
audit, and unchanged by this one.

The three families the auditor called out as extending its own starting baseline
(derived-fork egress-denial marker, registered-writer coverage-gap persistence, post-reset
cron-state persistence) are already in our census, and the first two are already fenced by
`65ab481ad`. That agreement is corroboration, not a new finding.

## Result: the non-SQL class is NOT complete

This is the finding that matters.

The non-SQL durability class was never enumerated with the same rigour as the SQLite side. Still
unexamined systematically:

- filesystem and secure-file publication, removal and rename;
- asset-store local and S3 operations;
- external-provider effects.

Concrete examples the auditor surfaced while establishing the boundary:

- reset-time `AssetStore::wipe_all` performed OUTSIDE the reset transaction guard
  (`crates/snapback-engine/src/local/engine.rs:8645`);
- owner-only secure-file writes and fsyncs (`crates/snapback-kernel/src/secure_file.rs:291`);
- the asset store's durable mutation interface
  (`crates/snapback-kernel/src/assets_store.rs:48`, `:94`, `:110`).

Note what this does NOT say. It does not say those specific sites are unguarded bugs — the reset
wipe, for instance, is argued elsewhere to be correctly reset-owned. It says the class was never
swept, so we do not know what else is in it.

## Consequence for the program

- Claims scoped to SQLite-side durable writes can rest on this census.
- **No closure claim covering "durable writes" generally should be made yet.** The non-SQL side
  needs its own systematic sweep first.

The existing non-SQL ticket and the authority-to-effect handoff design between them enumerate
roughly a dozen effects, but that list was assembled from the same sink-first pass, not from an
independent inventory of filesystem and provider sinks. It should be treated as a starting point,
not as the population.

## Next

Run the equivalent independent sweep for non-SQL durability: every filesystem write, rename,
unlink and fsync; every asset-store and S3 mutation; every outbound call that mutates remote state
— built independently, then diffed against the existing list.

## Provenance

Read-only adversarial completeness audit against `56741a708`. Full inventory with file:line
citations appended below.

---

## Result

The supplied baseline extends by **three operation families**:

1. derived-fork egress-denial marker;
2. registered-writer coverage-gap persistence;
3. post-reset cron-state persistence.

That is four durable sinks because coverage-gap persistence writes both SQLite and, when fork evidence exists, a synced sidecar. Composed with the user-supplied 19, the total is **22 operation families**. **INFERRED:** the checkout’s available audit still lists only the earlier 18 rows, so I could not verify the separate 19-entry ticket directly ([audit:167](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:167), [audit:179](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:179)).

### New admitted-context writes without a guard

| New operation | Why admitted / guard result | Structural safety | Durable state and severity |
|---|---|---|---|
| Derived-fork egress-denial marker | `LocalIbexActionHost` owns a `PreparedAuthority`; it records the denial at `deny_derived_fork_host_op` and only validates admission afterward ([engine.rs:4254](crates/snapback-engine/src/local/engine.rs:4254), [engine.rs:4273](crates/snapback-engine/src/local/engine.rs:4273)). The denial opens its own registered writer and autocommits at [connections.rs:467](crates/snapback-kernel/src/storage/connections.rs:467) and [connections.rs:471](crates/snapback-kernel/src/storage/connections.rs:471). No guard is live. | **No admission mechanism.** The request is always refused, but the only admission validation is after the write ([engine.rs:4277](crates/snapback-engine/src/local/engine.rs:4277), [engine.rs:4281](crates/snapback-engine/src/local/engine.rs:4281)). | Updates `_snapback_fork_egress_attempts_v1`: bounded attempt count and first/last timestamps by closed egress family ([connections.rs:471](crates/snapback-kernel/src/storage/connections.rs:471)). **Bookkeeping/security audit only:** no quota or money, no data exposure, no authority grant; actual egress remains denied ([instance_fork.rs:1428](crates/snapback-kernel/src/instance_fork.rs:1428), [instance_fork.rs:1446](crates/snapback-kernel/src/instance_fork.rs:1446)). |
| Registered-writer coverage-gap persistence | The marker path above and the known admitted vector-quarantine path both call `open_registered_system_writer_v1`; writer opening validates coverage before returning ([connections.rs:377](crates/snapback-kernel/src/storage/connections.rs:377), [connections.rs:396](crates/snapback-kernel/src/storage/connections.rs:396), [connections.rs:626](crates/snapback-kernel/src/storage/connections.rs:626)). A mismatch autocommits an UPDATE/INSERT at [operation_ledger.rs:496](crates/snapback-kernel/src/operation_ledger.rs:496) or [operation_ledger.rs:508](crates/snapback-kernel/src/operation_ledger.rs:508), and may also create, write and sync a sidecar at [connections.rs:60](crates/snapback-kernel/src/storage/connections.rs:60), [connections.rs:66](crates/snapback-kernel/src/storage/connections.rs:66), and [connections.rs:73](crates/snapback-kernel/src/storage/connections.rs:73). No guard is live. | **No admission recheck.** The checks compare coverage manifest/stream/continuity facts, not the request’s admission epoch ([connections.rs:284](crates/snapback-kernel/src/storage/connections.rs:284), [connections.rs:318](crates/snapback-kernel/src/storage/connections.rs:318)). It is nevertheless fail-closed: after recording the gap the writer open returns an error ([connections.rs:147](crates/snapback-kernel/src/storage/connections.rs:147), [connections.rs:164](crates/snapback-kernel/src/storage/connections.rs:164)). | Monotonically marks operation-coverage continuity `broken`, with detection time/reason; the sidecar duplicates the evidence when fork receipts exist ([operation_ledger.rs:475](crates/snapback-kernel/src/operation_ledger.rs:475), [connections.rs:27](crates/snapback-kernel/src/storage/connections.rs:27)). **Bookkeeping/control-plane availability only:** no quota or money, no data exposure, no authority grant; it removes a completeness claim and can force fork recreation ([connections.rs:108](crates/snapback-kernel/src/storage/connections.rs:108)). |
| Post-reset cron-state persistence | `coordinated_app_reset_inner` receives an `AdmissionLease`; its effect guard covers only the reset transaction and is dropped when that closure returns ([server.rs:23707](crates/snapback-server/src/server.rs:23707), [server.rs:23742](crates/snapback-server/src/server.rs:23742), [server.rs:23765](crates/snapback-server/src/server.rs:23765)). Reset publication happens later and calls an implicit-autocommit cron-state upsert at [engine.rs:8780](crates/snapback-engine/src/local/engine.rs:8780) and [jobs.rs:1267](crates/snapback-kernel/src/storage/jobs.rs:1267). No guard is live there. | **INFERRED structurally safe for predecessor/successor crossing.** The committed-reset stream ticket remains installed during publication ([server.rs:23793](crates/snapback-server/src/server.rs:23793)); the successor process generation is installed and cron is rebuilt before persistence ([engine.rs:8665](crates/snapback-engine/src/local/engine.rs:8665), [engine.rs:8699](crates/snapback-engine/src/local/engine.rs:8699)). There is still no revalidation of the original lease. | Upserts `_snapback_meta`’s cron scheduler projection ([jobs.rs:1267](crates/snapback-kernel/src/storage/jobs.rs:1267)). **Bookkeeping/scheduling only:** no direct quota or money, data exposure, or authority grant; it can alter future cron scheduling. |

The known vector-generation quarantine remains part of the supplied 19, not a new extension: its autocommit sink is [vector/sqlite.rs:572](crates/snapback-kernel/src/vector/sqlite.rs:572), reached with `PreparedInvocation` live at [engine.rs:30475](crates/snapback-engine/src/local/engine.rs:30475) and settled before the later admission validation at [engine.rs:30518](crates/snapback-engine/src/local/engine.rs:30518).

## Complete production non-`tx.commit()` SQLite list

These are all actual or potentially autocommitting families found in production kernel source.

| Family | Source occurrences | Admission result |
|---|---|---|
| Existing direct-autocommit admitted effects | Stream attempts [settlement.rs:17](crates/snapback-kernel/src/storage/settlement.rs:17); stream transcripts [stream_transcripts.rs:209](crates/snapback-kernel/src/storage/stream_transcripts.rs:209); watch transition/begin/retry [watches.rs:598](crates/snapback-kernel/src/storage/watches.rs:598), [watches.rs:679](crates/snapback-kernel/src/storage/watches.rs:679), [watches.rs:835](crates/snapback-kernel/src/storage/watches.rs:835); webhook reservation [webhooks.rs:121](crates/snapback-kernel/src/storage/webhooks.rs:121); vector quarantine [vector/sqlite.rs:572](crates/snapback-kernel/src/vector/sqlite.rs:572). | Already in the supplied 19; not reanalysed. |
| Cron-state upsert | [jobs.rs:1267](crates/snapback-kernel/src/storage/jobs.rs:1267). | Guarded for normal scheduler claims and results ([engine.rs:22282](crates/snapback-engine/src/local/engine.rs:22282), [engine.rs:22307](crates/snapback-engine/src/local/engine.rs:22307), [engine.rs:25880](crates/snapback-engine/src/local/engine.rs:25880)); post-reset caller is the new unguarded case above. |
| Protected-checkpoint closure bookkeeping | Shared `&Connection` sinks at [proof_checkpoint.rs:1676](crates/snapback-kernel/src/proof_checkpoint.rs:1676) and [proof_checkpoint.rs:1751](crates/snapback-kernel/src/proof_checkpoint.rs:1751); bare calls at [proof_checkpoint.rs:2698](crates/snapback-kernel/src/proof_checkpoint.rs:2698), [proof_checkpoint.rs:2725](crates/snapback-kernel/src/proof_checkpoint.rs:2725), [proof_checkpoint.rs:3189](crates/snapback-kernel/src/proof_checkpoint.rs:3189), [proof_checkpoint.rs:3202](crates/snapback-kernel/src/proof_checkpoint.rs:3202), and [proof_checkpoint.rs:3438](crates/snapback-kernel/src/proof_checkpoint.rs:3438). | Named erase/recovery is operator/checkpoint scope. Protected-record erasure is admitted but its outer guard spans the entire call ([engine.rs:6608](crates/snapback-engine/src/local/engine.rs:6608)). No new gap. |
| Derived-fork coverage receipt | [auth_invalidation.rs:581](crates/snapback-kernel/src/storage/auth_invalidation.rs:581). | Startup/fork publication only; no admitted production caller is present. **INFERRED from the source call graph.** |
| Migration cancellation | [migration_executor.rs:2756](crates/snapback-kernel/src/storage/migration_executor.rs:2756). | Migration/operator lane, not admitted app invocation ([audit:212](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:212)). |
| Managed-branch custody | Reconcile [fork_promotion.rs:872](crates/snapback-kernel/src/fork_promotion.rs:872); reap [fork_promotion.rs:945](crates/snapback-kernel/src/fork_promotion.rs:945), [fork_promotion.rs:958](crates/snapback-kernel/src/fork_promotion.rs:958); create/failure/activate [fork_promotion.rs:1076](crates/snapback-kernel/src/fork_promotion.rs:1076), [fork_promotion.rs:1094](crates/snapback-kernel/src/fork_promotion.rs:1094), [fork_promotion.rs:1106](crates/snapback-kernel/src/fork_promotion.rs:1106), [fork_promotion.rs:1117](crates/snapback-kernel/src/fork_promotion.rs:1117), [fork_promotion.rs:1128](crates/snapback-kernel/src/fork_promotion.rs:1128), [fork_promotion.rs:1137](crates/snapback-kernel/src/fork_promotion.rs:1137); drop [fork_promotion.rs:1285](crates/snapback-kernel/src/fork_promotion.rs:1285), [fork_promotion.rs:1298](crates/snapback-kernel/src/fork_promotion.rs:1298). | Server-derived AdminWrite/operator authority, not a consumed app `PreparedAuthority` ([engine.rs:9937](crates/snapback-engine/src/local/engine.rs:9937), [host_ops.rs:1130](crates/snapback-engine/src/host_ops.rs:1130)). |
| Promotion contention loss | [fork_promotion.rs:3863](crates/snapback-kernel/src/fork_promotion.rs:3863). | Operator/system promotion machinery ([audit:214](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:214)). |
| Registered-writer egress marker and conditional coverage-gap record | [connections.rs:471](crates/snapback-kernel/src/storage/connections.rs:471), [operation_ledger.rs:496](crates/snapback-kernel/src/operation_ledger.rs:496), [operation_ledger.rs:508](crates/snapback-kernel/src/operation_ledger.rs:508). | New admitted cases above. |
| Startup/pre-auth schema and seed writes | Hosted watermark [hosted_edge.rs:21](crates/snapback-kernel/src/auth/hosted_edge.rs:21); throttle [throttle.rs:1258](crates/snapback-kernel/src/auth/throttle.rs:1258); sender replay [auth_sender.rs:65](crates/snapback-kernel/src/storage/auth_sender.rs:65); core infrastructure [storage.rs:6112](crates/snapback-kernel/src/storage.rs:6112); history [proof_checkpoint.rs:901](crates/snapback-kernel/src/proof_checkpoint.rs:901); search [search/sqlite.rs:25](crates/snapback-kernel/src/search/sqlite.rs:25), [search/sqlite.rs:113](crates/snapback-kernel/src/search/sqlite.rs:113), [search/sqlite.rs:129](crates/snapback-kernel/src/search/sqlite.rs:129), [search/sqlite.rs:159](crates/snapback-kernel/src/search/sqlite.rs:159); vector [vector/sqlite.rs:53](crates/snapback-kernel/src/vector/sqlite.rs:53), [vector/sqlite.rs:155](crates/snapback-kernel/src/vector/sqlite.rs:155); jobs [jobs.rs:313](crates/snapback-kernel/src/storage/jobs.rs:313), [jobs.rs:394](crates/snapback-kernel/src/storage/jobs.rs:394). | Executed during open or hosted preflight before request admission ([storage.rs:2535](crates/snapback-kernel/src/storage.rs:2535), [audit:209](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:209)). |
| Branch/promotion infrastructure DDL | Branch registry/overlay/effects/pending [branches.rs:131](crates/snapback-kernel/src/branches.rs:131), [branches.rs:559](crates/snapback-kernel/src/branches.rs:559), [branches.rs:773](crates/snapback-kernel/src/branches.rs:773), [branches.rs:984](crates/snapback-kernel/src/branches.rs:984); in-app branch/custody [fork_promotion.rs:413](crates/snapback-kernel/src/fork_promotion.rs:413), [fork_promotion.rs:676](crates/snapback-kernel/src/fork_promotion.rs:676); promotion tables/ALTERs [fork_promotion.rs:3024](crates/snapback-kernel/src/fork_promotion.rs:3024), [fork_promotion.rs:3091](crates/snapback-kernel/src/fork_promotion.rs:3091), [fork_promotion.rs:3103](crates/snapback-kernel/src/fork_promotion.rs:3103). | Operator/branch setup, not an admitted invocation effect ([audit:213](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:213)). |
| Compiled bare-connection mutations without a production caller | Branch teardown, version allocation, replay floor, reconciliation [branches.rs:235](crates/snapback-kernel/src/branches.rs:235), [branches.rs:279](crates/snapback-kernel/src/branches.rs:279), [branches.rs:346](crates/snapback-kernel/src/branches.rs:346), [branches.rs:1145](crates/snapback-kernel/src/branches.rs:1145); search quarantine [search/rebuild.rs:26](crates/snapback-kernel/src/search/rebuild.rs:26); legacy history policy [proof_checkpoint.rs:1149](crates/snapback-kernel/src/proof_checkpoint.rs:1149). | **INFERRED from exhaustive textual call-site search:** no non-test production caller; `allocate_child_version`’s production calls all pass a transaction ([branches.rs:591](crates/snapback-kernel/src/branches.rs:591), [branches.rs:805](crates/snapback-kernel/src/branches.rs:805), [fork_promotion.rs:1718](crates/snapback-kernel/src/fork_promotion.rs:1718)). |

### Raw SQL and physical SQLite durability

- The production raw-SQL commits are authorization interlock commit at [storage.rs:875](crates/snapback-kernel/src/storage.rs:875) and auth-mode commit at [auth_mode.rs:222](crates/snapback-kernel/src/storage/auth_mode.rs:222). The former is a shared cut whose admitted callers are already classified in the existing guarded/unguarded sets; the latter owns the mode transition and drains admission ([audit:207](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:207)). Auth-rescue’s raw commits are test-support fault branches only ([auth_rescue.rs:268](crates/snapback-kernel/src/storage/auth_rescue.rs:268)).

- Persistent journal/checkpoint operations outside `tx.commit()` are startup `journal_mode=WAL` at [storage.rs:6101](crates/snapback-kernel/src/storage.rs:6101), shutdown WAL checkpoint and `journal_mode=DELETE` at [storage.rs:2681](crates/snapback-kernel/src/storage.rs:2681) and [storage.rs:2694](crates/snapback-kernel/src/storage.rs:2694), fork checkpoint at [instance_fork.rs:1081](crates/snapback-kernel/src/instance_fork.rs:1081), and registered lifecycle checkpoint at [connections.rs:434](crates/snapback-kernel/src/storage/connections.rs:434). These change physical durability/layout but create no new logical application state and run in startup/shutdown/operator lanes.

- SQLite backup/page-copy writes are fork staging and retained-base copies at [instance_fork.rs:813](crates/snapback-kernel/src/instance_fork.rs:813) and [instance_fork.rs:967](crates/snapback-kernel/src/instance_fork.rs:967), managed-branch base/head copies at [branches.rs:412](crates/snapback-kernel/src/branches.rs:412) and [branches.rs:422](crates/snapback-kernel/src/branches.rs:422), materialized checkpoints at [proof_checkpoint.rs:2450](crates/snapback-kernel/src/proof_checkpoint.rs:2450), and auth backup image publication at [auth.rs:2248](crates/snapback-kernel/src/storage/auth.rs:2248). They are operator/backup destinations, not admitted served-store writes ([audit:220](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:220)).

Shared `&Connection` helpers for watch enqueue/firing, job enqueue/claim/finish, retention/meta counters and integrity indexes do not create separate autocommit cuts because every production call passes a transaction ([watches.rs:1267](crates/snapback-kernel/src/storage/watches.rs:1267), [jobs.rs:705](crates/snapback-kernel/src/storage/jobs.rs:705), [storage.rs:20578](crates/snapback-kernel/src/storage.rs:20578), [storage.rs:20609](crates/snapback-kernel/src/storage.rs:20609), [storage.rs:11784](crates/snapback-kernel/src/storage.rs:11784)). The only production bare `query_row` DML found is branch child-version `UPDATE … RETURNING` at [branches.rs:279](crates/snapback-kernel/src/branches.rs:279); production prepared-statement DML originates from transactions, for example [storage.rs:17304](crates/snapback-kernel/src/storage.rs:17304) and [storage.rs:19003](crates/snapback-kernel/src/storage.rs:19003).

## Completeness boundary

The census is now **source-complete for production SQLite logical mutations, raw SQL commits, write-capable PRAGMAs, SQLite backup destinations, bare-`Connection` helpers, and internally opened SQLite writers visible in the reviewed Rust source**. It remains a source census, not compiler-enforced effect analysis; dynamically generated or macro-hidden SQL remains an **INFERRED** boundary already acknowledged by the audit ([audit:43](issues/shelved/20260821-complete-admission-effect-guard-commit-proof-coverage.md:43)).

It is **not complete for the broader non-SQL durability class**. Still unexamined systematically are filesystem/secure-file publication, removal and rename; asset-store local/S3 operations; and external-provider effects. Concrete examples include reset-time `AssetStore::wipe_all` outside the reset transaction guard ([engine.rs:8645](crates/snapback-engine/src/local/engine.rs:8645)), owner-only secure-file writes and fsyncs ([secure_file.rs:291](crates/snapback-kernel/src/secure_file.rs:291)), and the asset store’s durable mutation interface ([assets_store.rs:48](crates/snapback-kernel/src/assets_store.rs:48), [assets_store.rs:94](crates/snapback-kernel/src/assets_store.rs:94), [assets_store.rs:110](crates/snapback-kernel/src/assets_store.rs:110)). The coverage-gap sidecar is included above only because it is directly embedded in the newly admitted registered-writer path.

No files were modified.