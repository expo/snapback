# S10 engine/store census and handoff

Date: 2026-10-21. Design lane S10-D, P0-S10 / P1b prerequisite.
Source snapshot: `7beb568132ed46178e00351ebe9809f374e3c762` on
`sb4-pg/s10-design`. No production code changes, builds, database runs,
remote commands, clones or sub-agents. Design:
[store-port RFC §3.4](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores).

## Headline and counting rules

**98 concrete SQLite `Store`/`Tx` tokens in 37 production engine/host files**:
54 in 16 engine files, 44 in 21 host files. The identity API and public
SQLite re-export add **36 tokens in four core files**, for **134 in 41**.
The brief's approximate 257 references / 48 files is not reproduced by this
scope. Including unit-test source gives 196 tokens / 60 engine/host files,
or 240 / 65 across the core and host outside adapters. These counts are
source tokens, not calls, imports resolved by rustc, unique lines, or a new
standing inventory.

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
every production token, so counting is independently auditable. Tests are
reported separately rather than charging fixture constructors to the host.

Useful starting searches, from the repository root (the matches require the
filtering above):

```sh
rg -n '\b(Store|Tx)\b' snapback4/crates/snapback4-core/src/engine snapback4/crates/snapback4/src
rg -n '^impl.*for|pub.*trait ' snapback4/crates/snapback4-core/src/engine/postgres snapback4/crates/snapback4-core/src
rg -n 'store::|\.changes\b|\.conn\(' snapback4/crates/snapback4-core/src/engine snapback4/crates/snapback4/src
```

**11 of 25 existing storage-family traits have explicit Postgres impls.**
There is **no Postgres asset-family implementation in this snapshot**, and
no `Ledger` trait/type under `engine/postgres/`. Its inherent transaction
methods and buffered `tail::Tail` are the existing ledger machinery.
`PostgresEngine::supported` still rejects jobs/actions/routes/schedules,
assets/native programs, timed publication, union audiences and some
maintained shapes even where individual family adapters now exist.
Adapter conformance is not host readiness.

One mandatory cross-family dependency is easy to miss:
`engine/mod.rs:952` calls `assets::require_placement` for **every identified
mutation**, even without asset fields. That helper immediately reads
`AssetTransaction::placement_record` (`assets.rs:784–785`). A refusal for
the whole asset contract would stop data-only HTTP writes. S10c must extract
and implement a narrow real `AssetPlacementReader` before its ordinary
mutation smoke; the rest of asset upload/storage can remain refused. Do not
fake absence based on the current schema: stored bindings/cancellations must
still constrain ids. Activation's unconditional `time_audience_clock` read
(`engine/activation.rs:85`) likewise needs its metadata fact even if timed
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
| `AssetIntentReader`, `AssetTransaction` | `store/assets.rs` | **Missing** | Ledger + upload intent/view/sweep operations; physical bytes are a separate P1b dependency |
| `MetadataReader`, `MetadataWriter` | `store/metadata.rs` | **Missing** | PG has `_meta` SQL inside family implementations, not these typed traits |
| `ActivationReader`, `ActivationTransaction`, `ActivationPreparation` | `store/activation_access.rs` | **Missing** | Evaluator attach/adoption is not the shared opening/activation contract; preparation uses SQLite `ReleaseCheck` |
| `TimelineWorkReader` | `store/activation_access.rs` | **Missing** | Operator work counts |
| `ReleaseTransaction` | `store/release.rs` on `ReleaseCheck` | **Missing** | Release preflight; more release/history operations remain inherent/free functions |
| `DevResetStore` | `store/dev_reset.rs` | **Missing** | Contract itself takes four concrete SQLite-Tx callbacks |
| `StepTransaction` | `store/steps.rs` on action/effect owner views | **Missing** | Neither PG request nor outbox conformance supplies durable external steps |
| `ChangeEvidence` | `store/change_evidence.rs` on store and tx | **Missing** | Missing/incomplete evidence must widen; never certify retained authority |
| `InspectionCatalog` | `store/inspect.rs` on `Catalog` | **Missing** | PG inspect-role session still to build |

Count traits individually in the paired rows: 11 present, 14 absent, 25 total.
`CommitTransaction` is additional committer infrastructure, currently
implemented for SQLite `Tx`, not a durable-state family. The remaining
inherent-only families below also need new contracts; they are not included
in this denominator.

The following inherent names already have a semantic trait destination.
Counts are **direct concrete transaction/store calls** in production engine
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

Counts here are static call expressions, E / H; not runtime frequencies.
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

The 39 engine `.transaction()` calls include the committer's one physical
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
| `committer.rs:133` mutates `tx.changes` | 1 | **new MemberEvidence::begin_member_evidence**; Rows already exposes footprint/widening |
| `activation.rs:202,206`, host `serve_adoption.rs:243`, `serve_release.rs:159` (three uses), `verbs/release_preview.rs:131,140,200,214` (two at 200), `verbs/releases.rs:308` access `adoption_report` | 2 E / 10 H | Neutral owned adoption report/accessor; preserve post-commit timing |
| `activation.rs:15,198` names/reads `store::opening::Metadata` | 2 | Neutral construction record; metadata captured before commit |
| `activation.rs:166,195` calls `release_history::finalize_restorations`, `event` | 1 each | **new ReleaseHistoryTransaction** |
| `maintains.rs:431` calls `dormant::rewrite_legacy_maintained_references` | 1 | **new EvolutionTransaction**, alongside Rows sequence rekeying |
| `dev_reset.rs:68` calls `backfills::has_evidence`, `prepare_inputs` | 1 each | **new EvolutionTransaction** |
| `actions/steps.rs:8`, `effect_steps.rs:8` import concrete owner views | 1 each (constructors at use sites) | Action/effect views over AnyTx implementing `StepTransaction` |
| `maintains.rs`, `recorded.rs`, `column_activation.rs` name `store::adoption_report` records | Multiple signatures/constructions | Move plain report types to neutral module; not a database operation |
| `store::{Bounds,Dir,LogEvent,DormantItem}` and receipt digest/id-reuse re-exports | Shared aliases | Import from neutral row/partition/release/receipt modules; not SQLite storage semantics |

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
| `project.rs`, `store_owner.rs`, `serve_lock.rs`, `verbs/run_admission.rs` | Preserve current SQLite default paths/sidecar ownership; PostgreSQL owner token, lease and tagged connections are P1b prerequisites. `run_admission.rs:71` still calls `.conn().busy_timeout(5s)`; replace with typed opening/operation timeout policy. |
| `dev_worker.rs:393–410` | Still obtains ledger location through `.store().conn().path()` and hashes store identity into a filesystem directory. Configure worker state/blob location bound to logical store id; do not derive a PG filesystem path from a URL. |
| `serve_changes.rs:216–228`, `serve_sync.rs`, `serve_ephemeral.rs` | Head, identity, receipt acknowledgements and evidence interval belong to coherent snapshots; unsupported evidence widens, never certifies. Process-local presence/ephemeral/notifiers stay P1 single-process coordination. |
| `serve_adoption.rs`, `serve_release.rs`, `release_files.rs`, `verbs/releases.rs`, `verbs/release_*` | Neutral release/preparation/report APIs; SQLite-only preview and stopped-file logic must not execute on PG. Immutable artifact/blob custody still needs P1b work. |
| `assets.rs`, `native.rs`, `dev_clock*.rs`, `dev_replay.rs`, `dev_refusal_response.rs` | Typed metadata/work/asset operations; asset bytes and native modules need their host storage independently of SQL family parity. |
| `verbs.rs`, `verbs/{adoption,residency,staging,work_records,sql,testing,test_fixture,security}.rs`, `main.rs`, witness smoke | Enum-backed inspection/factories for supported tools; explicit unsupported tooling refusals; common fixture helpers may intentionally request SQLite memory. |

Backend selection is proposed in RFC §3.4 as a resolved StoreConfig from
`--store-url` / `SNAPBACK4_STORE_URL`, retaining `--store <path>` and current
path defaults. URL/namespace/role/HA settings are data, not host type
parameters. The final spelling remains a lead commissioning choice.

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
| Family writes | Identity/requests/jobs/outbox use the existing shared-head guard; not the production owner lease fence of RFC §5 |

There is no general `savepoint/release/rollback_to`, `MemberEvidence`,
shared metadata/open/receipt/asset/release/history/reset/step/inspection
implementation hiding behind a `Ledger`. The only `InternalLedger` mention
under this directory is the memory-accounting helper in `prefetch.rs`, not
a durable ledger trait.

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

## Slice handoff, evidence and questions

- **S10a:** neutral SQLite-only enum handles, records, callbacks and engine/host
  signatures; affected SQLite core/host + committer, corpus/simulator and
  device/wasm evidence.
- **S10b:** remaining inherent methods, fields, free-function leaks and two host
  connection escapes onto semantic operations; affected family, opening,
  activation/release/reset/history/asset/receipt/time and host regressions.
  Make infallible unsupported-family boundaries fallible (including evidence
  access), preserving the existing explicit conservative evidence policy.
- **S10c:** Postgres arm, refusals, mandatory opening/metadata/receipt/ledger,
  placement reads and savepoint state, plus K0 coordination for direct
  producers; shared-family
  dispatch cases, no-partial-write refusals, nested rollback/NUL, overlap
  corpus/differential and C1 call-count evidence. No serve claim yet.
- **S10d:** configured host/readers and supported-family HTTP smoke; owner
  fencing, retry/ambiguous COMMIT and worker policy before listener readiness;
  unsupported profiles named explicitly.
- **S10e:** switch remaining evaluation/corpus/differential/experiment callers,
  retain regressions and performance evidence, retire PostgresEngine's duplicate
  executor; expand independently as missing P1a families land.

No code-level reason was found to reverse the enum decision. Shared receiver
borrows, savepoint rollback of buffered state, missing family contracts and
adapter record leaks would also need solving under a generic engine.

Lead questions (do not block this design commit): final configuration spelling
and the initial HTTP schema/family profile; ownership of mandatory P1a
opening/metadata/receipt/evidence/placement-read work; coordination with K0's
remaining direct producers and worker policy; timing of the
evaluator-retirement evidence run.
The full P1b HA/blob/release witnesses remain separate from S10 smoke.

Validation passed: source census and manual call-receiver review; all 134
appendix entries checked against their source lines; `git diff --check`;
repository-root `./ref-check --verbose` (564 LLP documents, 11,595 refs,
zero errors or unchecked refs). The RFC retains one Revised line. No product
test or performance result is claimed by this documentation change.

## Complete production type-site appendix

Paths are relative to `snapback4/crates/`. S = SQLite `Store`, T = SQLite
`Tx`. Each listed line carries one token unless a line appears twice with
different letters. A = existing semantic family boundary; B = inherent /
transaction / record seam; D = host signature or factory. Mixed sites are
marked A/B. All 134 tokens are listed, including imports/re-export.

### Engine: 54 tokens / 16 files

| File | Tokens | Sites | Group |
| --- | ---: | --- | --- |
| `snapback4-core/src/engine/actions/steps.rs` | 1 | 13T | A/B |
| `snapback4-core/src/engine/actions.rs` | 5 | 4T, 140T, 147T, 356T, 358T | A/B |
| `snapback4-core/src/engine/activation.rs` | 1 | 7S | B |
| `snapback4-core/src/engine/committer.rs` | 8 | 2S, 2T, 47T, 51T, 109S, 127T, 143S, 179T | B |
| `snapback4-core/src/engine/dev_reset.rs` | 4 | 22T, 23T, 24T, 25T | B |
| `snapback4-core/src/engine/effect_steps.rs` | 2 | 7T, 11T | A/B |
| `snapback4-core/src/engine/effects.rs` | 1 | 586T | A/B |
| `snapback4-core/src/engine/following_history/projection.rs` | 2 | 180T, 269T | B |
| `snapback4-core/src/engine/following_history/read.rs` | 5 | 16T, 36T, 50T, 90T, 102T | B |
| `snapback4-core/src/engine/following_history/refresh.rs` | 1 | 290T | B |
| `snapback4-core/src/engine/following_history/session.rs` | 2 | 7T, 60T | B |
| `snapback4-core/src/engine/following_history.rs` | 1 | 20T | B |
| `snapback4-core/src/engine/maintains.rs` | 1 | 339T | A/B |
| `snapback4-core/src/engine/mod.rs` | 14 | 135S, 387S, 412S, 417S, 450S, 454S, 458S, 483S, 492S, 496S, 503S, 510S, 514S, 1363T | A/B |
| `snapback4-core/src/engine/release.rs` | 4 | 49S, 65S, 81S, 87S | A/B |
| `snapback4-core/src/engine/time_audience.rs` | 2 | 11T, 30T | A/B |

### Supporting core: 36 tokens / four files

| File | Tokens | Sites | Group |
| --- | ---: | --- | --- |
| `snapback4-core/src/identity/diagnostics.rs` | 1 | 8S | A |
| `snapback4-core/src/identity/read_sessions.rs` | 1 | 20S | A |
| `snapback4-core/src/identity.rs` | 33 | 11S, 11T, 136S, 140S, 144S, 155S, 194T, 218T, 227S, 234S, 240S, 249T, 254T, 305S, 327S, 338S, 342S, 349S, 357S, 374S, 402S, 405S, 475S, 482S, 500S, 509S, 542S, 545S, 557S, 679S, 692S, 756S, 845S | A |
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
| `snapback4/src/verbs.rs` | 2 | 833S, 1014S | D |
