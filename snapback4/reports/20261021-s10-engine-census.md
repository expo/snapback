# S10 engine/store census and handoff

Date: 2026-10-21. Design lane S10-D, P0-S10 / P1b prerequisite.
Revision 2 source snapshot: `67fef0dbde805c6e6bf2592abebdc4adccc5189f`
(`sb4-pg/main-mirror`, rebased into `sb4-pg/s10-design`). The original census
at `7beb568132ed46178e00351ebe9809f374e3c762` was reviewed at `8be8ea27b1`;
this revision refreshes the type-site appendix and landed P1-AS/K0c facts.
Docs only; no production code changes, builds, database runs or sub-agents. Design:
[store-port RFC §3.4](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores).

## Headline and counting rules

**123 concrete SQLite `Store`/`Tx` tokens in 37 production engine/host files**:
79 in 16 engine files, 44 in 21 host files. The identity API and public
SQLite re-export add **36 tokens in four core files**, for **159 in 41**.
The brief's approximate 257 references / 48 files is not reproduced by this
scope. These production counts are source tokens, not calls, imports resolved
by rustc, unique lines, or a new standing inventory.

Scope: `crates/snapback4-core/src/engine/` and
`crates/snapback4/src/`; supporting core files are listed separately.
Exclude SQLite `store.rs`/`store/`, Postgres `engine/postgres/`, test files
(`tests/`, `test_cases/`, `*_tests.rs`, `tests.rs`, `test_cases.rs`), and
`#[cfg(test)]` items for the production count. Mask comments and string/char
literals, keep lifetimes, then count standalone `Store`/`Tx` tokens. Exclude
`RuntimeError::Store`, `Error::Store`, their enum variant declarations,
`Self::Store`, and the **five `wasmi::Store` occurrences** in
`engine/native.rs`. `Bounds`, `Dir`, plain records and helper paths are
additional migration work, not those two concrete types. Tables below list
every production token, so counting is independently auditable. Test-only
fixture constructors are not charged to the host.

Useful starting searches, from the repository root (the matches require the
filtering above):

```sh
rg -n '\b(Store|Tx)\b' snapback4/crates/snapback4-core/src/engine snapback4/crates/snapback4/src
rg -n '^impl.*for|pub.*trait ' snapback4/crates/snapback4-core/src/engine/postgres snapback4/crates/snapback4-core/src
rg -n 'store::|\.changes\b|\.conn\(' snapback4/crates/snapback4-core/src/engine snapback4/crates/snapback4/src
```

**13 of 25 existing storage-family traits have explicit Postgres impls.**
P1-AS adds `AssetIntentReader` and `AssetTransaction`, including placement;
P1-OB's transaction/store outbox implementations are present. There is still
no `Ledger` trait/type under `engine/postgres/`. Its inherent transaction
methods and buffered `tail::Tail` are the existing ledger machinery.
`PostgresEngine::supported` still rejects jobs/actions/routes/schedules,
assets/native programs, timed publication, union audiences and some
maintained shapes even where individual family adapters now exist.
Adapter conformance is not host readiness.

One mandatory cross-family dependency is easy to miss:
`engine/mod.rs` calls the member facade's `require_placement` for **every identified
mutation**, even without asset fields. That helper immediately reads
`AssetTransaction::placement_record` (`assets.rs`). A refusal for
the whole asset contract would stop data-only HTTP writes. The landed P1-AS
adapter initializes `_asset_intents` with `placement`, `facts`, and `state`
(`engine/postgres/assets_schema.rs:62–66`), and serves the real lookup
(`engine/postgres/assets.rs:261`). S10c exposes that existing implementation
through the narrow `AssetPlacementReader`; no new relation or invented absence
is needed. Asset upload/bytes and asset-typed schemas stay unadmitted. Do not
fake absence based on the current schema: stored bindings/cancellations must
still constrain ids. Activation's unconditional `time_audience_clock` read
(`engine/activation.rs:86`) likewise needs its metadata fact even if timed
publication stays unsupported; the optional timed-wakeup runner must be
capability-gated.

## (a) Calls already on family contracts

These operations need enum forwarding and neutral arguments, not a second
policy implementation. Existing shared policy takes `impl Trait`/`dyn Rows`
in many more files than the concrete-type table below.

| Family traits | SQLite implementation | Postgres implementation now | Remaining integration |
| --- | --- | --- | --- |
| `Rows` | `store.rs` | `engine/postgres/store.rs` | 29 SQLite overrides versus 17 PG overrides; preserve all applicable overrides, including prefetch, metered scans, caps, sequence identity migration and restored authority; unsupported features need admission refusals |
| `PartitionRows` | `store/partition.rs` | `engine/postgres/log.rs` | 8 versus 6 overrides; PG lacks audience epoch/time overrides and currently refuses union sync; append is buffered on PG |
| `AuthorityTransaction` | `store/authority.rs` | `engine/postgres/authority.rs` | Shared authority policy already exists; extend the same owner/head fences to the unified host |
| `IdentityTransaction`, `IdentityStore` | `store/identity.rs` | `engine/postgres/identity.rs` | Store impl is on `RefCell<&mut PgStore>`, transaction impl on `PgTx`; shared API wrappers still name SQLite |
| `RequestsTransaction`, `RequestsStore` | `store/requests.rs` | `engine/postgres/requests.rs` | Both explicit; evaluator still rejects action/route programs |
| `JobTransaction`, `JobStore` | `store/jobs.rs` | `engine/postgres/jobs.rs` | Both explicit; `JobStore` uses `&mut self`, unlike SQLite's public shared-receiver conveniences |
| `OutboxTransaction`, `OutboxStore` | `store/outbox.rs` | `engine/postgres/outbox.rs`, `outbox_store.rs` | Store impl on a scoped `RefCell<&mut PgStore>`; shared admission policy exists; retain batched-tail efficiency |
| `ReceiptReader` | `store/receipts.rs` | **Missing** | PG has receipt-specific inherent access with different signatures, not this contract |
| `AssetIntentReader`, `AssetTransaction` | `store/assets.rs` | `engine/postgres/assets.rs` (P1-AS) | Ledger/intent/view/sweep adapter is implemented; reuse placement DDL/reader in S10c. Host asset schema and bytes remain outside the initial profile. |
| `MetadataReader`, `MetadataWriter` | `store/metadata.rs` | **Missing** | PG has `_meta` SQL inside family implementations, not these typed traits |
| `ActivationReader`, `ActivationTransaction`, `ActivationPreparation` | `store/activation_access.rs` | **Missing** | S10c needs the actual `open_selected_at`/`activate` subset: selected backend/release, markers, clock, required epoch writes. P1a release + activation is a named S10d prerequisite. |
| `TimelineWorkReader` | `store/activation_access.rs` | **Missing** | Operator work counts |
| `ReleaseTransaction` | `store/release.rs` on `ReleaseCheck` | **Missing** | Named S10d prerequisite with activation: minimal deploy/history/selection path in Postgres; local immutable release source/host metadata precedes reopen. More release/history operations remain inherent/free functions. |
| `DevResetStore` | `store/dev_reset.rs` | **Missing** | K0c replaced the contract's four raw-Tx callbacks with restricted `MemberTx` callbacks; neutral handles must preserve that restriction. |
| `StepTransaction` | `store/steps.rs` on action/effect owner views | **Missing** | Neither PG request nor outbox conformance supplies durable external steps |
| `ChangeEvidence` | `store/change_evidence.rs` on store and tx | **Missing** (independent lane in progress) | Unknown certifies nothing. S10b changes `preserved_between`'s missing-footprint empty-vector mapping. Certified changes/sync are excluded from S10d's passed denominator until this family is qualified. |
| `InspectionCatalog` | `store/inspect.rs` on `Catalog` | **Missing** | PG inspect-role session still to build |

Count traits individually in the paired rows: 13 present, 12 absent, 25 total.
`CommitTransaction` is additional committer infrastructure, currently
implemented for SQLite `Tx`, not a durable-state family. The remaining
inherent-only families below also need new contracts; they are not included
in this denominator.

The following inherent names already have a semantic trait destination.
Call counts in this table retain the reviewed pre-K0c baseline
`7beb568132ed46178e00351ebe9809f374e3c762`; K0c forwarding is reconciled below.
They are **direct store/transaction calls** in production engine
(E) / host (H), excluding calls on generic Runner row handles and wrappers
such as `Engine::jobs`:

| Existing name | E / H | Destination |
| --- | --- | --- |
| `Tx::get` | 9 / 1 | `Rows::get` |
| `Tx::scan` | 5 / 1 | `Rows::scan` |
| `Tx::put` | 3 / 0 | `Rows::put` |
| `Tx::asset` | 3 / 0 | `Rows::asset` / `AssetTransaction::asset` (disambiguate dispatch) |
| `Tx::track_time_audience` | 2 / 0 | `Rows` |
| `Tx::time_audience_pending` | 1 / 0 | `Rows` |
| `Tx::time_audience_published` | 1 / 0 | `Rows` |
| `Tx::next_seq` | 24 / 2 | `PartitionRows` |
| `Store::job`, `Store::jobs` | 1 / 0 each | `JobStore` with scoped shared-receiver convenience |
| `Store/Tx::schedule_shape`, `schedule_boundary` | 1 / 1 each | `JobTransaction` / `JobStore` |
| `Store::latest_schedule_boundary`, `job_summaries` | 0 / 1 each | `JobStore` |
| `Store/Tx::replay_bound` | 3 / 0 | Shared `receipts::replay_bound` over `ReceiptReader` |
| `Store/Tx::preserved_between` | 0 / 4 | Shared revocation policy over `ChangeEvidence` |
| `Store/Tx::footprint_between` | 0 / 3 | Shared revocation policy over `ChangeEvidence` |
| `Tx::check_selected_release` and preparation check | 2 / 0 combined | `ActivationReader` / `ActivationPreparation` |
| Macro-generated `store_identity` | 8 / 0 | `MetadataReader` |
| Macro-generated `generation_value` | 1 / 0 | `MetadataReader` |
| Macro-generated `schema_marker` | 6 / 0 | `MetadataReader` |

Other inherent aliases of `Rows`/`PartitionRows` (`lookup`, `count_prefix`,
`delete`, `claim_asset`, `release_asset`, `append_log`, membership/log-span
reads and commit-time reads) have **zero direct concrete calls** in this
scope: they are reached through the row/partition traits or generic policy.
For example, `through_activation.rs` and `live_bulk.rs` use trait handles;
counting every `.get()` would mostly count maps and Runner helpers.
`partition::append` supplies append-log dispatch and must remain shared.
The remaining macro-generated metadata conveniences (`release_value`,
`release_revision_value`, `release_native_digest`,
`time_audience_clock_value`, `worker_session_family`,
`worker_session_revision`, `worker_family_revision`, `worker_status`,
`deployment_environment`, `dev_value`, `set_dev_value`,
`set_deployment_environment`, `set_worker_status`) have zero direct calls
in E/H; the host still uses raw `meta`/`set_meta` at the counts below.

## (b) Inherent-only operations still called above the adapter

Counts here are the same reviewed pre-K0c static call baseline, E / H;
not current raw-Tx counts or runtime frequencies. K0c changes are listed below.
Only actual store/transaction receivers count: `Engine::reader`,
`Engine::seq`, native module jobs, filesystem `open`, ephemeral `memory`,
iterator `count`, and map `get` are excluded. A paired name carries its own
count. Supporting identity calls are noted after the table. Trait names
marked **new** are design allocations, not claims of existing code.

| Operation | E / H | Contract / disposition |
| --- | --- | --- |
| `transaction` | 39 / 1 | **new TransactionControl/StoreOpening**; 38 engine openers remain outside the committer driver, not evidence of completed K0 routing |
| `read_transaction` | 15 / 6 | **new StoreOpening**, `ReadSnapshot` |
| `authority_transaction` | 3 / 0 | **new StoreOpening**, scoped `with_authority_snapshot`; three more in identity |
| `opening_transaction` | 1 / 0 | **new StoreOpening**, validated opening snapshot |
| `commit` (physical) | 43 / 1 | `CommitTransaction` / transaction control; includes one forwarding implementation in committer |
| `commit(value)` (member) | 24 / 0 | Member facade/disposition, never physical COMMIT |
| `rollback` (physical) | 29 / 4 | **new TransactionControl**, includes read snapshots |
| `rollback(value)` (member) | 4 / 0 | Member facade/disposition |
| `abandon` (physical snapshot) | 1 / 0 | **new TransactionControl**; ephemeral publication ends durable snapshot before volatile commit |
| `MemberTx::abandon` | 2 / 0 | Facade implementation/drop; not adapter transaction rollback |
| `savepoint` | 6 / 0 | **new TransactionControl**: member, program, two job chunks, timeline chunk, seed sequences |
| `release` | 2 / 0 | Same; member and program |
| `rollback_to` | 6 / 0 | Same; rollback **and release**, evidence widening/cache invalidation retained |
| `record_commit` | 16 / 0 | **new LedgerTransaction**; includes evidence persistence/pruning, not just `_commits` |
| `commits_after` | 1 / 1 | **new LedgerReader** on transaction snapshot |
| `record_applied`, `bind_applied` | 2 / 0 each | **extend receipt family** with writes; retain original insert/bind order on SQLite |
| `applied_outcome` | 1 / 0 | Receipt read convenience (`ReceiptReader` with original outcome semantics) |
| `seq` | 1 / 2 | **new LedgerReader** / head capability |
| `store_id`, `optional_store_id` | 0 / 1 each | `MetadataReader::store_identity`; preserve required versus optional behavior above the trait |
| `meta` | 2 / 39 | Existing typed `MetadataReader` / job-family queries, by key below |
| `set_meta` | 0 / 5 | `MetadataWriter` / `JobTransaction`; no arbitrary-key escape |
| `time_audience_clock` | 4 / 0 | **new TimeAudienceTransaction** / existing typed metadata read |
| `pin_time_audience_clock` | 3 / 0 | **new TimeAudienceTransaction**, monotone writer pin |
| `due_time_audience`, `selected_time_audience` | 1 / 0 each | Same, bounded due/point facts |
| `next_time_audience` | 1 / 0 | Same; host's `Shared::next_time_audience` is not a store call |
| `remove_time_audience` | 1 / 0 | Same |
| `set_time_audience_published` | 2 / 0 | Same |
| `history_point`, `history_head` | 7 / 0; 2 / 0 | **new FollowingHistoryReader**; retain byte-length preflight before decode |
| `record_asset` | 1 / 0 | `AssetTransaction` extension |
| `asset_viewed`, `record_asset_view` | 2 / 0; 1 / 0 | `AssetTransaction` extension; host `Engine::record_asset_view` excluded |
| `forget_asset`, `stage_stale_assets_for` | 1 / 0 each | `AssetTransaction` extension; staging and unlink after commit stay distinct |
| `asset_path`, `assets_dir`, `ephemeral_assets` | 2 / 0; 2 / 0; 1 / 0 | **new AssetStorage/BlobStore**; filesystem result is SQLite-specific |
| `require_dev_replay_store` | 0 / 1 | Move shared policy helper over `OutboxTransaction::replay_deployed`; currently an inherent impl in `engine/effects.rs` |
| `reader` | 1 / 0 | **new StoreOpening**, same-backend connection factory |
| `is_memory` | 0 / 3 | Backend capability; detached-reader fallback must not treat PG failure as memory |
| `is_read_only` | 3 / 0 | Backend capability/open mode |
| `exclude_ephemeral` | 4 / 0 | **new StoreOpening** catalog filtering; no durable write |
| `accept_open` | 1 / 0 | **new StoreOpening** acceptance; SQLite close-time tuning stays internal |
| `finish_open` | 1 / 0 | **new StoreOpening**; atomic upgrade, capture construction metadata, commit/rollback |
| `activate_at_with_launch` | 1 / 0 | **new StoreActivation** with `AnyPreparation` + AnyTx callbacks; solo committer transaction |
| `dormant_inventory` | 1 / 1 | **new ReleaseInspection/EvolutionReader** |
| `fork_memory` | 1 / 0 | **new FixtureStore**; SQLite backup today; PG explicit refusal initially |
| `Store::memory` | 1 / 3 | Factory config (SQLite memory); preserve fixture/device semantics |
| `Store::open`, `open_read_only`, `open_with_busy_timeout` | 0 / 3; 0 / 15; 0 / 2 | Configuration/opening + inspection intent; paths and timeouts stay in SQLite adapter |
| `retain_ownership` | 0 / 1 | SQLite ownership operation; PG uses owner token/lease, not a file handle |
| `conn` | 0 / 2 | Remove host escape; worker ledger location and run-admission busy policy (§d) |
| `rows`, `rows_limited` | 0 / 5; 0 / 2 | **new StoreInspection** bounded/full fixture reads; keep limits and decode order |
| `sizes` | 0 / 1 | **new StoreInspection**; SQLite file/page metrics, explicit PG unsupported or separately typed metrics |
| `successor`, `check_timeline_activation`, `adoption_estimate` | 0 / 1; 0 / 1; 0 / 2 | Shared successor/activation assessment over facts + **new StoreInspection**; no fake PG estimates |
| `snapshot_to` | 0 / 2 | **new StoreSnapshot/FixtureStore**; SQLite backup semantics stay internal; PG preview needs another implementation or refusal |
| `release_status`, `prune_dormant` | 0 / 6; 0 / 2 | **new ReleaseInspection/EvolutionStore**; prune remains durable/committer-owned |
| `has_release_history`, `release_referenced`, `release_adopted` | 0 / 2; 0 / 1; 0 / 1 | **new ReleaseInspection** |
| `capture_preview_active`, `preview_populations`, `visit_preview_lost`, `preview_parent_dormant` | 0 / 1 each | **new ReleasePreview/EvolutionReader** |
| `preview_hidden_population`, `preview_empty_population`, `rollback_incompatible_values` | 0 / 1 each | Same; raw byte callbacks should become neutral records, not SQL callbacks |
| `inspection_generation`, `inspection_table_population`, `inspection_has_data` | 0 / 1 each | **new StoreInspection** |
| `inspection_schema_json`, `inspection_schema_text` | 0 / 1 each | `ActivationReader`/inspection snapshot; keep JSON/text error policy |
| `inspection_worker_reports`, `handler_failure_records` | 0 / 1 each | **new StoreInspection**, work/worker records; make unsupported results fallible |
| `visit_recent_commit_clock`, `recent_commit_max_at`, `record_witness_barrier` | 0 / 1 each | **new LedgerReader/LedgerTransaction**, with existing bounded clock scan semantics |

The reviewed baseline's 39 engine `.transaction()` calls include the committer's one physical
opener. Three additional raw writer openers and three authority snapshots
live in identity/read-session code, outside E. Its shared API also calls
`commit` three times, `rollback` three times,
`resolve_session_snapshot` twice and
`invalidate_expired_authority_session` once; the latter two already combine
shared authority policy with a SQLite store snapshot and belong on scoped
store views. Together with the host replay opener, these agree with the
child committer RFC's 49 conservative transaction/authority opener sites.
Handle migration must not be reported as completion of the direct-producer
committer slices.

`meta` keys read above the adapter: store identity, generation, release,
native digest, time-audience clock, deployment environment, dev replay,
hold schedules, and dynamic schedule boundaries. Existing `MetadataReader`
spells the metadata facts; `JobStore` spells the schedule boundary. Writes
are two job boundary/shape writes plus one hold-schedules write in
`dev_replay.rs`, worker status in `dev_worker.rs`, and deployment environment
in `verbs/staging.rs`. Use their existing typed family methods.

Non-method leaks must also move; merely replacing `Store` tokens misses:

| Site | Count | Destination |
| --- | --- | --- |
| `committer.rs:253` mutates `tx.changes` | 1 | **new MemberEvidence::begin_member_evidence** in S10a; Rows already exposes footprint/widening |
| `activation.rs:204,208`, host `serve_adoption.rs:251`, `serve_release.rs:159` (three uses), `verbs/release_preview.rs:131,140,200,214` (two at 200), `verbs/releases.rs:308` access `adoption_report` | 2 E / 10 H | Neutral owned adoption report/accessor; preserve post-commit timing |
| `activation.rs:15,199` names/reads `store::opening::Metadata` | 2 | Neutral construction record; metadata captured before commit |
| `activation.rs:167,196` calls `release_history::finalize_restorations`, `event` | 1 each | **new ReleaseHistoryTransaction** |
| `maintains.rs:431` calls `dormant::rewrite_legacy_maintained_references` | 1 | **new EvolutionTransaction**, alongside Rows sequence rekeying |
| `committer/member_store.rs:167` calls `backfills::has_evidence`, `prepare_inputs` | 1 each | **new EvolutionTransaction** |
| `actions/steps.rs:8`, `effect_steps.rs:8` import concrete owner views | 1 each (constructors at use sites) | Action/effect views over AnyTx implementing `StepTransaction` |
| `maintains.rs`, `recorded.rs`, `column_activation.rs` name `store::adoption_report` records | Multiple signatures/constructions | Move plain report types to neutral module; not a database operation |
| `store::{Bounds,Dir,LogEvent,DormantItem}` and receipt digest/id-reuse re-exports | Shared aliases | Import from neutral row/partition/release/receipt modules; not SQLite storage semantics |

### K0c reconciliation of the reviewed call baseline

The type appendix and family table are current at the rebased snapshot;
the two call-count tables above preserve the reviewers' independently checked
baseline rather than labeling every member call as a current raw-Tx call.
K0c changes that baseline as follows:

- `MemberTx` has **no `Deref`**, owning-Tx return, connection, `abandon` or
  physical commit. It implements `Rows` explicitly (29 `<Tx as Rows>`
  delegations) plus narrow typed forwarding in `committer/member_store.rs`.
  The member surface must stay restricted when its borrowed handle becomes
  `AnyTx`; S10a's temporary SQLite bridge is only on owning enum handles.
- The 24 member `commit(value)` calls become `complete(value)`; physical
  COMMIT remains the driver's. `rollback` and `abort` consume the member and
  return an opaque disposition; drop tries rollback, and the driver validates
  the disposition against the frame before COMMIT. Rollback errors retain
  their original cause. The facade's two former `abandon` calls disappear;
  the physical ephemeral snapshot still closes before volatile publication.
- Restricted nested `savepoint`/`release`/`rollback_to` each add one explicit
  forwarding call; `record_commit` adds one forwarding call with the typed
  `(program, principal, kind)` tuple. The facade adds one internal `rollback`
  call. These delegations are not new durable producers. Host ephemeral
  metadata/head reads move into the committer's post-commit publication
  helper, which opens no transaction.
- Engine reset's four concrete-Tx callback tokens disappear; its seed/backfill
  work moves behind the restricted facade, including the remaining
  `backfills::{has_evidence,prepare_inputs}` leak. The driver's evidence reset
  remains `committer.rs:253` and must become `begin_member_evidence` in S10a.
- `Pending`/`Resolution` hold owned continuation data; post-commit work cannot
  retain a transaction borrow. Production still runs one member: there is no
  production queue, serial batch or retry. K0 keeps those and the remaining
  direct producers. Converting a handle is not evidence of their completion.

The net type-token change is +25: 30 in the new forwarding file, minus four
reset callback tokens and one committer token. Engine file count stays 16
(the forwarding file enters, reset leaves); host/supporting counts are unchanged.

## (c) Concrete SQLite for a real reason

The server Engine itself has no fundamental requirement for SQLite. The
following implementations do, and must stay behind their respective
capabilities rather than acquire meaningless Postgres substitutes:

- The native device: `crates/snapback4-device/src/sqlite.rs` implements
  `DeviceStore`/`DeviceTx` for the core's SQLite types;
  `sqlite_residency.rs` uses SQLite transactions and sidecars. Keep those
  types and the existing public SQLite re-export. The browser memory/wasm
  device must not link Postgres/server-family dispatch.
- SQLite backup/fork/preview and stopped-store restore (`store/fork.rs`,
  `store/tooling.rs`, host `verbs/release_preview.rs`), file identity and
  ownership (`store/ownership.rs`, host `store_owner.rs`), WAL/SHM handling
  and immutable read-only inspection (`verbs/releases.rs:90–105`), page and
  file sizes, PRAGMA/busy policy. These are backend-specific implementations
  of semantic tooling operations; a Postgres refusal is acceptable until
  its tooling exists. They do not justify a host SQLite type dependency.
- SQL inspection: `verbs/sql.rs:4,70`, `verbs/work_records.rs:3`,
  `verbs/releases.rs:105`, `verbs/witness/smoke.rs:31` name concrete
  `store::inspect::Inspection`/`InspectionRows`. This is separate from the
  Store/Tx token count. Replace host names with AnyInspection; SQLite's
  connection, generated views and query authorization stay in its adapter.
  `InspectionCatalog` alone does not cover query execution or retention views.
- SQLite-specific test instrumentation (authorizers, PRAGMA policy,
  corruption/legacy fixtures, total changes, WAL, backup and device tests)
  keeps direct SQLite types or narrowly scoped test accessors. Common
  Engine tests convert their constructor input to AnyStore. Do not move
  connection inspection into a production enum escape hatch to preserve
  tests.
- `engine/native.rs`'s five `wasmi::Store` tokens describe a WebAssembly
  runtime, entirely unrelated to the database. Leave them alone.

## (d) Host migration sites and operational dependencies

The type-site appendix lists every host Store/Tx token. Host coupling also
exists without naming those types:

| Host area | Concrete work |
| --- | --- |
| `serve.rs` Shared, `serve_start.rs`, `serve_readers.rs` | Retain one concrete Engine; resolve store config at open; reader factory must reconnect to the selected backend with the same identity/generation/role. `FreshDirectory` stays a SQLite configured temporary store. `is_memory` is a capability, not an error fallback. |
| `project.rs`, `store_owner.rs`, `serve_lock.rs`, `verbs/run_admission.rs` | Preserve current SQLite default paths/sidecar ownership; S10d takes the thin §5 owner-token/lease/tagged-connection slice before its listener. `run_admission.rs:71` still calls `.conn().busy_timeout(5s)`; replace with typed opening/operation timeout policy. |
| `dev_worker.rs:393–410` | Still obtains ledger location through `.store().conn().path()` and hashes store identity into a filesystem directory. Configure worker state/blob location bound to logical store id; do not derive a PG filesystem path from a URL. |
| `serve_changes.rs:216–228`, `serve_sync.rs`, `serve_ephemeral.rs` | Head, identity, receipt acknowledgements and evidence interval belong to coherent snapshots; unsupported evidence widens, never certifies. Process-local presence/ephemeral/notifiers stay P1 single-process coordination. |
| `serve_adoption.rs`, `serve_release.rs`, `release_files.rs`, `verbs/releases.rs`, `verbs/release_*` | Named S10d prerequisite: P1a release/activation and minimal deploy/history/selected-release reopen with matching local immutable source/host metadata. SQLite-only preview/stopped-file logic must not execute on PG. BlobStore/artifact-digest custody can wait for P1b. |
| `assets.rs`, `native.rs`, `dev_clock*.rs`, `dev_replay.rs`, `dev_refusal_response.rs` | Typed metadata/work/asset operations; asset bytes and native modules need their host storage independently of SQL family parity. |
| `verbs.rs`, `verbs/{adoption,residency,staging,work_records,sql,testing,test_fixture,security}.rs`, `main.rs`, witness smoke | Enum-backed inspection/factories for supported tools; explicit unsupported tooling refusals; common fixture helpers may intentionally request SQLite memory. |

Backend selection is adopted in RFC §3.4 as a resolved StoreConfig from
`--store-url` / `SNAPBACK4_STORE_URL`, retaining `--store <path>` and current
path defaults. URL/namespace/role/HA settings are data, not host type
parameters. CLI overrides the environment URL; a path selector combined with
a URL selector refuses. Namespace and HA settings are explicit; credentials
stay in deployment config, while release records bind the logical store id
and non-secret configuration.

## Existing Postgres transaction machinery

`engine/postgres/store.rs` already supplies these inherent operations. These
are implementations to adapt, not evidence that a matching shared trait
exists:

| Operation | Current behavior / gap |
| --- | --- |
| Store `new`, `opening_transaction`, `transaction` | Mutable `Client`, statement cache, generation, stats; serialized writer locks `_head`, read snapshot uses REPEATABLE READ; attach uses evaluation namespace/version and layout |
| Tx `query`, `execute`, `batch` | Adapter-only driver API; `execute` flushes pending tail, `query` does not; bind guard poisons transaction on invalid text, including NUL |
| Tx `commit`, `rollback` | Commit checks terminal refusal and flushes tail before physical commit; rollback consumes the transaction |
| Tx `rollback_program`, `rollback_prefetch` | Named rollback/release helpers; program rollback clears row cache; no general nested member savepoint protocol yet |
| Tx `record_commit` | Buffers one `tail::Commit`; does not implement SQLite's durable change-evidence recorder/pruning |
| Tx `applied`, `applied_bound` | Return optional outcome text; binding check differs from the shared ReceiptReader record interface; NUL keys are absent |
| Tx `record_applied` | One protected receipt insertion with name/digest/time; SQLite currently inserts and binds separately |
| Tx `record_effects` | Shared emission/admission policy prepares effects, then buffers tail entries including presence |
| Tx `flush_tail` (`tail.rs`) | One data-modifying CTE updates head and inserts commit, log, effects and presence; receipt write is subsequent; only one pending commit slot |
| `PartitionRows::next_seq`, `append_log` | Cached head + 1 and buffered partition event arrays; membership/log-span/commit-time reads implemented |
| `Rows::prefetch`, `prefetch_enabled`, `fill_prefetch` | Bounded speculative point/lookup cache, transaction-local; writes invalidate it; explicit rollback helpers; preserve prefetch-on/off parity |
| Other Rows overrides | Sequence values/set/ids/rekey, lifetime effect keys, adoption walk, get/lookup/scan/index head/metered scan, cap counts/prefix counts, put/delete |
| Family writes | Identity/requests/jobs/outbox/assets use the existing shared-head guard; not the production owner lease fence of RFC §5 |

There is no general `savepoint/release/rollback_to`, `MemberEvidence`,
shared metadata/open/receipt/release/history/reset/step/inspection
implementation hiding behind a `Ledger`. The only `InternalLedger` mention
under this directory is the memory-accounting helper in `prefetch.rs`, not
a durable ledger trait.

S10c must repair this machinery rather than preserve its current accidents:
remove implicit `flush_tail` from `execute`; batch shared-policy effects into
the tail; guard the single commit slot against overwrite; flush **inside
`SAVEPOINT member` before release**, advancing or clearing the cached head in
the same step. Finish any staged receipts in insert-then-bind order before
release. Snapshot/restore tail/head/evidence and invalidate the separate
`rows_cache` on rollback. Port K0b's two-member test to real Postgres: member
two sees member one's sequence/receipt/metadata, allocates its successor,
then rolls back or fails without undoing member one. Also witness a failed
tail flush before release, a second `record_commit` refusing the occupied slot,
and multiple effects retaining batched call counts. Receipt-only tails must
not drop effects silently. This interim uses one CTE tail flight per completed
member and one physical COMMIT; §6.3's eventual single flight per serial batch
needs separate visibility evidence before production batching. K0c production
is still single-member.

The enum must not wrap PostgresEngine and call its independent
`mutate_once`. Reuse its adapter and tail; retain the old evaluator only
through the bounded overlap comparison, then migrate/delete the duplicate
policy. Tests in `engine/postgres/tests/`,
`experiments/postgres/`, core `tests/corpus.rs` and
`crates/snapback4-difftest/src/stores.rs` all need explicit disposition.
Family tests move with the adapter. Corpus/differential/experiment callers
move to unified Engine with the existing fixtures and named exclusions
preserved, and the private-cluster runner must still execute required cases.
No skip becomes a pass by replacing the evaluator.

## Slice handoff and adopted decisions

These are future implementation/evidence requirements, not results of this
lane. All slices retain supported SQLite behavior; the absent-evidence fix
explicitly returns unknown while known evidence keeps its behavior.

| Slice | Scope and prerequisites | Required evidence |
| --- | --- | --- |
| **S10a** | SQLite-only enums/signatures, neutral records and scoped callbacks. Temporary owning `AnyStore`/`AnyTx` SQLite `Deref`/forwarding bridge, **never** a member dereference; include the `tx.changes` evidence operation and activation/release free-function bridges so it compiles alone. | Affected SQLite core/host, K0c rollback/frame/continuations, corpus/simulator, device/wasm and SQLite-free/no-default-features build. |
| **S10b** | Complete semantic extraction, remaining fields/free functions and both host connection escapes; remove temporary owning bridges. Make unsupported-family boundaries fallible. Policy is **unknown certifies nothing**; change `preserved_between`'s missing-footprint empty-vector mapping. | Family/opening/activation/release/reset/history/asset/receipt/time and host regressions; no driver access above the port, no writes on refused open, absent evidence explicitly unknown. |
| **S10c** | Postgres arm, admission/default-method refusals, required opening/activation subset, metadata, receipts, ledger/control, existing P1-AS placement relation/reader and repaired tail/savepoints/head cache. K0 retains remaining producer routing, continuations, queue and serial batch. | 13 family contracts through enum dispatch; real-Postgres K0b two-member property, tail failure/slot guards/effect call counts, NUL/nested rollback and no-partial-write refusals; overlap corpus/differential/C1 prefetch on/off; **internal HTTP-host witness**, no public serve/lease claim. |
| **S10d** | Public configured `serve`, same-backend readers, **named P1a release + activation prerequisite** and minimal deploy/history/selection/reopen tooling. Only admitted producers require K0 routing. Gate startup runners; take thin §5 owner-token, uncancellable/ambiguous-COMMIT and logical-store-bound worker-ledger policy immediately before listener readiness. | Deploy fresh Postgres, stop/reopen persisted release with matching immutable source/host metadata; stale source/selection/binding refusals. Queries, identified mutation replay/id reuse, session resolve/logout, ephemeral hubs, reader generation and §5 host witnesses. Absent evidence is unknown; certified changes/sync remain outside passed until qualified. |
| **S10e** | Keep `PostgresEngine` through S10d as prefetch-on/off oracle. Migrate remaining callers and teach difftest's `postgres-unsupported:` classifier `E_STORE_UNSUPPORTED`; keep `Unsupported` outside passed. Delete duplicate executor after overlap corpus, exclusions and C1 call counts match. | Existing/shrunk regressions, fixed-seed store campaign, prefetch and call-count parity, private-cluster absence failures and affected SQLite/device checks. Optional P1a features expand independently. |

The initial HTTP profile is ordinary queries, identified data mutations,
bearer session resolve/logout and process-local ephemeral hubs. Re-home
`PostgresEngine::supported()`'s semantic exclusions as named unified-engine
admission refusals: union sync, `not before`/timed publication, asset columns
and typed arguments beyond placement, jobs/actions/routes/schedules/native,
row-keyed recount views and its rejected maintained/private-column shapes.
Keep shared schema validation. Do not inherit successful Postgres trait
defaults (`audience_epoch = 0`, `time_audience_published = true`, no-op
publication/asset operations, etc.) as support: use fallible refusal boundaries.
The evaluator's ephemeral exclusion does not apply to the process-local hub.
SQL inspection, workers/claims and release operations beyond the required
minimum stay unadmitted. `serve_start` gates child-session/replay work and
schedule/native/time runners on admitted families; `JobStore` alone admits
neither job programs nor schedule production.

S10c does not wait for all of K0. Before S10d only the admitted producers
must use the committer; excluded `fire_schedule_range` and the rest of the
opener census remain K0 work. S10c owns the opening subset it needs;
S10d requires `ReleaseTransaction`, `ActivationReader`/`ActivationTransaction`/
`ActivationPreparation` and every operation actually called by
`open_selected_at`/`activate`, plus minimal release history and selection.
Existing deploy tooling prepares local immutable `releases/N/` source and
compiled host metadata, then a fenced solo Postgres activation installs the
first generation/schema/programs/catalog/markers, history and selected release
atomically. Public `serve` reopens the persisted selection, loads that source
directory, attaches with the expected release/store identity and checks bound
schema/program metadata. Edited source or a racing selection cannot adopt
caller source. The local `current`/`releases.jsonl` are convenience copies;
Postgres owns activation/history. Resolve ambiguous activation from durable
records before cleanup/retry. BlobStore/artifact-digest custody can wait;
the full P1b HA/blob/optional-tooling witnesses remain separate.

Change evidence is still absent at this snapshot; another lane is implementing
it. Missing/pruned/incomplete evidence is unknown (`null` where the wire can
express it, otherwise `E_STORE_UNSUPPORTED`), never certified `preserved: []`.
Certified `/changes` and sync join S10d's passed denominator only after enum
conformance for the actual relation, recording, prune-to-1,000 policy and
coherent head/evidence snapshots. The existing empty-vector mapping is the
case to change in S10b, not the policy to preserve.

Both blind reviews at `8be8ea27b1` were SOUND WITH CHANGES, no FUNDAMENTAL.
The RFC's panel disposition records each finding and the lead's adopted
configuration/profile/ownership/retirement decisions. No code-level reason
was found to reverse the enum decision. Full P1b publication/HA/blob claims
remain separate from these witnesses.

Validation passed for revision 2: the source-token recount reproduces the
reviewed 134-token baseline and the current 159 tokens in 41 files; all 159
appendix locations and exclusion scopes match source. Local links/fences,
both slice tables, panel finding coverage, the single Revised line and the
docs-only scope pass. `git diff --check` and repository-root
`./ref-check --verbose` pass (564 LLP documents, 11,603 refs, zero errors or
unchecked refs). No product test or performance result is claimed by this
documentation change.

## Complete production type-site appendix

Paths are relative to `snapback4/crates/`. S = SQLite `Store`, T = SQLite
`Tx`. Each listed line carries one token unless a line appears twice with
different letters. A = existing semantic family boundary; B = inherent /
transaction / record seam; D = host signature or factory. Mixed sites are
marked A/B. All 159 current tokens are listed, including imports/re-export;
K0c's explicit `<Tx as Rows>` forwarding accounts for 29 of the 30 new
`committer/member_store.rs` tokens.

### Engine: 79 tokens / 16 files

| File | Tokens | Sites | Group |
| --- | ---: | --- | --- |
| `snapback4-core/src/engine/actions.rs` | 5 | 4T, 140T, 147T, 356T, 358T | A/B |
| `snapback4-core/src/engine/actions/steps.rs` | 1 | 13T | A/B |
| `snapback4-core/src/engine/activation.rs` | 1 | 7S | B |
| `snapback4-core/src/engine/committer.rs` | 7 | 2S, 2T, 67T, 174S, 181S, 247T, 324T | B |
| `snapback4-core/src/engine/committer/member_store.rs` | 30 | 3T, 12T, 15T, 18T, 21T, 24T, 27T, 30T, 33T, 36T, 39T, 42T, 45T, 48T, 51T, 54T, 57T, 61T, 64T, 67T, 70T, 73T, 76T, 87T, 90T, 93T, 96T, 99T, 102T, 105T | B |
| `snapback4-core/src/engine/effect_steps.rs` | 2 | 7T, 11T | A/B |
| `snapback4-core/src/engine/effects.rs` | 1 | 586T | A/B |
| `snapback4-core/src/engine/following_history.rs` | 1 | 20T | B |
| `snapback4-core/src/engine/following_history/projection.rs` | 2 | 180T, 269T | B |
| `snapback4-core/src/engine/following_history/read.rs` | 5 | 16T, 36T, 50T, 90T, 102T | B |
| `snapback4-core/src/engine/following_history/refresh.rs` | 1 | 290T | B |
| `snapback4-core/src/engine/following_history/session.rs` | 2 | 7T, 60T | B |
| `snapback4-core/src/engine/maintains.rs` | 1 | 339T | A/B |
| `snapback4-core/src/engine/mod.rs` | 14 | 137S, 389S, 414S, 419S, 452S, 456S, 460S, 485S, 494S, 498S, 505S, 512S, 516S, 1366T | A/B |
| `snapback4-core/src/engine/release.rs` | 4 | 49S, 65S, 81S, 87S | A/B |
| `snapback4-core/src/engine/time_audience.rs` | 2 | 12T, 31T | A/B |

### Supporting core: 36 tokens / 4 files

| File | Tokens | Sites | Group |
| --- | ---: | --- | --- |
| `snapback4-core/src/identity.rs` | 33 | 11S, 11T, 136S, 140S, 144S, 155S, 194T, 218T, 227S, 234S, 240S, 249T, 254T, 305S, 327S, 338S, 342S, 349S, 357S, 374S, 402S, 405S, 469S, 476S, 494S, 503S, 536S, 539S, 551S, 673S, 686S, 750S, 839S | A |
| `snapback4-core/src/identity/diagnostics.rs` | 1 | 8S | A |
| `snapback4-core/src/identity/read_sessions.rs` | 1 | 20S | A |
| `snapback4-core/src/lib.rs` | 1 | 64S | C (device/public SQLite export) |

### Host: 44 tokens / 21 files

| File | Tokens | Sites | Group |
| --- | ---: | --- | --- |
| `snapback4/src/dev_clock.rs` | 1 | 117S | D |
| `snapback4/src/dev_clock_store.rs` | 1 | 221S | D |
| `snapback4/src/dev_worker.rs` | 3 | 7S, 62S, 67S | D |
| `snapback4/src/main.rs` | 1 | 184S | D |
| `snapback4/src/project.rs` | 3 | 5S, 270S, 281S | D |
| `snapback4/src/release_files.rs` | 1 | 199S | D |
| `snapback4/src/serve_readers.rs` | 2 | 194S, 195S | D |
| `snapback4/src/store_owner.rs` | 3 | 3S, 230S, 231S | D |
| `snapback4/src/verbs.rs` | 2 | 833S, 1014S | D |
| `snapback4/src/verbs/adoption.rs` | 3 | 3S, 12S, 104S | D |
| `snapback4/src/verbs/release_dependencies.rs` | 1 | 291S | D |
| `snapback4/src/verbs/release_narration.rs` | 3 | 5S, 35S, 98S | D |
| `snapback4/src/verbs/release_preview.rs` | 3 | 47S, 55S, 165S | D |
| `snapback4/src/verbs/release_safeguards.rs` | 3 | 3S, 37S, 49S | D |
| `snapback4/src/verbs/release_visibility.rs` | 2 | 3S, 36S | D |
| `snapback4/src/verbs/releases.rs` | 5 | 119S, 181S, 365S, 596S, 857S | D |
| `snapback4/src/verbs/residency.rs` | 2 | 38T, 129S | D |
| `snapback4/src/verbs/staging.rs` | 1 | 22S | D |
| `snapback4/src/verbs/test_fixture.rs` | 2 | 14S, 26S | D |
| `snapback4/src/verbs/testing.rs` | 1 | 75S | D |
| `snapback4/src/verbs/work_records.rs` | 1 | 94S | D |
