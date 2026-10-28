# Release inspection JSON

A release inspector describes the active deployment and its retained source. Read this record before choosing a release or continuing an inspection page.

```js
import { cli, startServe, cleanup } from "snapback4/proof";
await cli(["deploy", "deployment"]);
const host = await startServe("deployment", { timeoutMs: 30000 });
try {
  console.log((await cli(["releases", "deployment", "latest", "--json"])).stdout);
} finally { await cleanup(() => host.stop()); }
```

## Fields and automatic workers (SQLite)

`releases <dir> --json` prints the same JSON object as plain `releases`.
The active identity is `current`; `release` is its equal compatibility spelling.
Select immutable source with `releases <dir> N|latest|current --json`.
`latest` is the highest successfully adopted source, which may differ from
`current` after rollback.

| Field | Meaning |
| --- | --- |
| current, release, previous_active, latest | Active release, previous activation target, highest successfully adopted release; null when absent |
| generation, revision | Monotone execution generation and release-history revision |
| native_digest | Active native module digest, or null |
| events | Up to 16 activation/prune records: id, at (Unix ms), operation, release, previous, generation, revision, summary |
| events_after | Last returned event id, or null; pass as --after to get the next page |
| items | Up to 16 dormant storage items; with --event N, the retained items for that event |
| items_after | Last returned item key, or null; pass as --items-after for the next page |
| event | Requested event id, or null for the current dormant inventory |
| workers | Up to 16 [metadata key, status text] pairs; use doctor for handler health |
| live | Actual source/view identity: release, source, target, exact, optional parent, and rowShape |
| rowShape | Same as live.rowShape: target id, matchesTarget, operation differences with expected/served results, served table columns and extraction children. A successful call alone does not preserve a frozen client’s result fields. |
| selected | Present only with N/latest/current: {release, current (boolean), digest} for that immutable source |

`rollback DIR --to N --check --json` reports the candidate’s `rowShape` before activation. `matchesTarget` compares the bound wire results of N’s query/mutation exports, including missing operations and nullable/omittable fields; it does not promise identical business behavior or authorization. A live rollback view prints its shape differences and retained children on stdout. Equivalent qualification ids can share a guarded view only for identical executable source and hiding policy; `live.target` and `rowShape.target` name its canonical registered target. Rollback explains when the requested id is equivalent. Exact extraction rollback is preferred only when its data and guards fit without hidden predecessor rows or newly invented empty/defaulted cells.

Continue while a page is nonempty; a full final page may require one empty read.
The first stdout line of serve is its listening URL; stderr's SNAPBACK4_READY
confirms startup. The proof kit's startServe waits with timeoutMs and stops an
owned child on timeout (`guide testing`). Captured conventional server/worker
entries and named service workers start automatically. Resource files belong
under SNAPBACK_PROJECT_DIR, the immutable release root in serve. Packages stay
installed on the host; --worker is an explicit conventional-entry override.

## Postgres: initial HTTP profile

`deploy`, `serve`, `doctor` and `sql` accept `--store-url URL` or
`SNAPBACK4_STORE_URL`; the CLI value overrides the environment. Prefer the
environment form for credentials: a password in `--store-url` is visible in
process arguments. A URL requires an explicit `schema` and `ha` parameter:

```sh
export SNAPBACK4_STORE_URL='postgres://app@/app?host=%2Fvar%2Frun%2Fpostgresql&schema=my_app&ha=none'
snapback4 deploy ./deployment
snapback4 serve ./deployment --worker-state-dir /var/lib/my-app/workers --port 4400
snapback4 doctor --release ./deployment --json
```

`SNAPBACK4_WORKER_STATE_DIR` also supplies the absolute durable state directory.
Its ledger filename binds to the logical store id; serve validates it before
listening, even while worker execution is excluded. `--store <path>` selects
SQLite. For deploy/serve it aliases an existing SQLite store into the deployment;
omit it to create the default `store.sqlite`. A path plus a URL (including the
environment URL) refuses `E_STORE_CONFIG`. A deployment with a store binding
requires that URL again on restart. The immutable `store-binding.json` records
only the logical store id and non-secret connection binding, including effective
Unix socket paths. Before bootstrap, a synced `store-pending.json` intent records
that identity and target without credentials. A failed first binding write can be
retried after fixing the filesystem error: deploy requires the original intent,
matching store id and a read-only check of exact tables, columns, types,
constraints, indexes, generation, markers and admitted schema/programs. Recovery
runs no DDL or upgrades. Only then is the validated typed intent atomically
published as the binding, dropping unknown JSON fields, before any owner claim.
Ordinary open of an already-bound store retains its fenced additive upgrades.
An identity/target mismatch or incomplete bootstrap refuses
`E_STORE_CONFIG`; restore the original complete store and intent before retrying.
Never edit the intent to adopt another store. Selected stores require their binding. Preserve its local
`releases/N` source tree; serve selects the release recorded in Postgres and
checks its compiled schema/programs before admitting traffic.

This profile admits PostgreSQL 16 and 17 through Unix sockets, with `ha=none`.
TCP hosts, mixed socket/TCP hosts and any `hostaddr` override refuse
`E_STORE_UNSUPPORTED: connection-tls` before connecting until the adapter supports TLS;
other HA modes refuse `ha-continuity` until their continuity checks are qualified.
Use direct connections or session pooling; transaction pooling and read replicas
are unsupported. This is the initial serving profile, without provider failover
or complete P1 parity qualification.

Queries, identified mutations with receipt replay, guest/password bearer sessions,
logout, process-local ephemeral hubs and ordinary maintained count/sum columns
with their private maintains, certified `/changes` and ordinary sync are available.
Change evidence retains the last 1,000 sequences and certifies complete intervals
of at most 500 commits. Missing, pruned or incomplete evidence remains
`preserved: null` on `/changes` and sync. Deploy
refuses `E_STORE_UNSUPPORTED` for assets beyond placement, jobs, actions, routes,
schedules, native programs, union sync, timed publication and row-keyed recounts. These runners and worker handlers
stay off. Backfills, renames and authority/lifetime evolution retain named refusals. Rollback, previews, prune, staging, saved versions,
SQL/data inspection, service token minting (`token`), release inspection and hot
activation are outside this profile. `token`, `rollback`, `releases`, `data` and
`prune` return `E_STORE_UNSUPPORTED: this operator command is outside the admitted store profile`; `sql` returns
`E_STORE_UNSUPPORTED: inspection is outside the admitted store profile`.
Stop serve and wait about three seconds for its lease to expire before deploying
another admitted release. Same-schema program
changes can activate; identical content stays on its existing release/generation.
A release may also add, redefine or drop ordinary maintained columns and indexes
on them, with all other schema declarations unchanged. Attach projects removed
fields and private totals; the common engine backfills/recounts existing sources
and mirrors parents before publishing the generation. Re-adding recounts from
sources. An overflowing backfill rolls back the entire activation. Initial zero
totals remain sparse; redefining a nonzero total to zero stores an explicit zero.
Row-keyed view-recount remains refused. Ordinary releases can add tables, optional/literal-defaulted columns and indexes, redefine/drop indexes, and retire ordinary tables/columns into dormant storage. `deploy DIR --restore-dormant` restores those names, rows, values and reference lifetimes atomically. Ordinary Postgres schema evolution currently refuses `evolution-authority` when the schema contains a durable temporal, read-through or recorded table, including an unchanged one. Their activation-time source retirement needs the later lifetime slice. Previously admitted maintained-column transitions with unchanged ordinary declarations remain available. Ordinary column types/bounds, requiredness, defaults and text/cap constraints can change, including when restoring a retained definition. Incompatible values become dormant together with transitive references to them; later compatible widening restores them without coercion. New required or context-defaulted columns need existing rows to supply their values: an empty table succeeds, while missing historical values refuse `E_ADOPT`. Contextual defaults never invent history. Unique/cap failures roll back the activation, including hiding/restoration. Authority declarations stay unchanged; retirement/restoration of tables carrying temporal/read-through/recorded or maintained authority waits for a later slice.

Serve acquires a positive store lease before its listener. A second serve refuses
`E_STORE_OWNERSHIP` while that lease is live; retry after expiry to take over a
crashed process. Renewal uses its own connection every 500 ms. Any failed or
uncertain renewal exits the process, closing listener and producers. In-flight
transactions remain token-fenced. In synchronous mode, a terminal G6
admission pause after an unconfirmed COMMIT or rollback also attempts one reason
line and exits, even when lease renewal remains healthy. This fail-stop is
armed once serving starts. Loss is published before bounded diagnostic output;
a stalled stderr reader cannot prevent exit (output drains for at most 100 ms,
then the line may be lost). The independent
watchdog observes that pause without locking the lease connection. The lease
and persisted read epoch expire before a fresh process takes over; the old
cache epoch never reopens and uncertain writes are never automatically replayed.
Early-lock-release mode retains its separate fenced durability recovery.
Startup cleanup matches store id, token and
holder, even after renewal loss. A known rolled-back claim attempts no release;
an unknown claim COMMIT retains cleanup identity without write authority.
Successful cleanup permits immediate corrected
startup; otherwise retry after expiry. Once serving, serve leaves the lease to
expire about three seconds after its last renewal, including on clean shutdown; deploy releases it after its fenced activation finishes. Doctor reports backend,
logical identity, owner token/holder and database-clock lease state without raw SQL.
SQL inspection currently refuses `E_STORE_UNSUPPORTED`. An unknown activation
COMMIT in short-lived deploy is resolved in process from persisted selection,
without replaying activation or arming serving's G6 fail-stop. A landed
activation completes `current` and `releases.jsonl` and releases the lease;
an unresolved result keeps its exact source for recovery.

## Postgres durability modes and read grants

Postgres defaults to synchronous commit (S). The explicit store URL setting
`commit=early` opts into E: for example append `&commit=early` to the configured
`SNAPBACK4_STORE_URL`; `commit=synchronous` selects S explicitly. Serve and
`doctor` disclose the selected mode. E releases writer locks at the data commit,
then acknowledges only after a WAL-generating, count-checked synchronous marker
covers that commit. Snapback readers and cache fills wait for their own snapshot
head to be durable, with a 250 ms hold bound per snapshot and retryable failure
on a history break or hold expiry. S1 qualification of E is still pending; this
setting makes no throughput or publication claim.

A raw PostgreSQL client outside Snapback can see the data transaction in the
window before its marker is durable. A PostgreSQL crash can lose that visible,
unacknowledged suffix. Use Snapback's reader APIs for the acknowledged-durability
contract; direct SQL observers must account for this window. E does not admit
SQL inspection or actions that the Postgres profile currently refuses.


Managed storage refuses foreign triggers, rewrite rules or row security with `E_STORE` / `SNAPBACK_MANAGED_RELATION_INTERCEPTION` on open, activation, reconnect and `doctor`, including foreign incoming foreign keys. Remove the reported interception and retry. Snapback's own index-key and device-residency triggers require their exact installed definitions; only recognized legacy constraints and their exact built-in triggers are admitted. Database event triggers are allowed. Doctor warns with every enabled trigger's name, event, tags (`all` when no command-tag filter is declared), owner, function and enabled mode; activation logs the same list once. Privileged code (event triggers or superuser-level DDL hooks) that rewrites activation DDL or movement semantics is outside the supported contract. Activation checks observable effects after installer DDL, after scratch DDL before first use, and immediately before COMMIT: managed and TEMP movement relations, by captured OID, must be plain heaps owned by the activation role without foreign interception. Replaced OIDs, views, materialized views, partitioned and foreign tables refuse. Before removing a live/dormant source, activation verifies the destination's expected final images and count in the same transaction; mismatch rolls back. Intentional overlays, backfills and narrowing advance the expected image. SQLite compares decoded values, so JSON key order from a rename is harmless. Postgres verification pages cap keys at 64 and combined compared payloads at 4 MiB, admitting one oversized row to ensure progress, under the existing five-second statement timeout. SQLite managed names match identifiers without ASCII case distinctions, including quoted table names.

Runtime DDL on managed relations while serving is explicitly outside the store fence model. Owner/head locks do not prevent external DDL, and admission does not poll catalogs on each request. Doctor and the next open, activation or connection replacement detect such changes.

For a single-owner Linux Postgres deployment, zero-flight revision-cache hits are opt-in through `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms`. These numbers declare a guarantee: during any grant, database time advances at most `(1 + rate_ppm/1000000) * CLOCK_BOOTTIME_elapsed + forward_jump_ms`, including suspend and every supported failover. They are not tuning estimates. For example, `1000,250` declares a maximum 0.1% relative rate excess and 250 ms cumulative forward adjustment; the three-second grant gets a local deadline below 2.747 s. Use this only when the deployment guarantees those bounds and all writers run the grant-aware protocol. Unset it for arbitrary clock steps, unqualified failover or mixed versions, and do not use it across VM pause/migration longer than the lease. Explicit malformed or non-UTF-8 bounds refuse startup. Clock-free G5 read-index batching is the Postgres HTTP default; `SNAPBACK4_G5_READ_INDEX=0` selects ordinary per-hit G5 validation. Serve startup and doctor print cache diagnostics. Serve reports its local startup tier; doctor reports the owner's persisted grant and clock declaration, with local activity explicitly unconfirmed: reconnect or local revocation can fall back to G5 before the persisted grant expires. Doctor does not use its own environment for that status and cannot infer owner-local RI batching or its off switch from persisted state. Opt-in is the default posture even with `ha=none`. Revisit default-on only after the roughly one-second G6 stall is explained, G5-versus-G6 write cost is measured, a durable compatibility marker makes pre-G6 binaries refuse grant-enabled stores, and Snapback can witness the clock contract instead of assuming it. A grant hit rechecks bearer authority and expiry with a fresh clock. Every local commit invalidates revision equality. Grant loss falls back to database reads; unknown COMMIT stops cached reads and new writers until fenced reacquisition with a fresh process/epoch. Graceful release drains cached reads first.


Clock-free G5 read-index batching is the default for eligible Postgres serving
reads: `SNAPBACK4_G5_READ_INDEX` unset or `=1` enables it, `=0` selects ordinary
G5, and other values refuse Postgres configuration. Eligible HTTP hits share a
fresh store-wide revision/owner validation statement started after each
participating request arrived. Reads arriving during a validation join the next
batch. The wait retains socket admission but releases execution workers and
reader loans. Timer-start failure, failed validation or the 8 ms proof-wait
budget resumes ordinary G5 with the original admission and deadline. Direct
blocking engine APIs always use ordinary G5 and never wait for an RI round.
This adds no grant or connection. SQLite, memory, personas and staging retain
their existing paths. `commit=early` uses ordinary D-gated G5; W/Stage R modes
fail closed until RI integrates W-bound V and two-image fills. With both settings
on, explicitly configured G6 bypasses RI enrollment entirely: live G6 hits
schedule zero RI rounds; G6 misses use ordinary G5. Startup prints that combined
mode; doctor distinguishes persisted grant evidence from unconfirmed owner-local
batching. See LLP 3000.009.001.000.002 §4.2.

Publication mode is shared with the existing HTTP reader pool and its factories;
changing the owner to a W/Stage R mode also rejects previously saved raw-head
proofs. Replacing a closed reader socket rechecks store binding and fresh RI
owner/revision SQL, and does not disable RI for other readers when G6 is off.
Explicit G6 retains its transport-loss revocation; ownership revocation and
commit uncertainty still block RI reuse.

RI compares the whole immutable fill stamp, including the unified revision, and
uses fill-time `SessionFacts`; the shared Rust resolver rechecks each caller's
authority and expiry. Ordinary per-read G5 rereads the digest's session projection.
Their equivalence relies on **every in-contract authority writer bumping the
unified revision in the same commit**: Postgres `identity.rs` inserts/updates,
`authority.rs` session/family invalidation and `session_clock.rs`
`set_clock_session` require the
serialized head fence; `opening.rs` enables unified commits, and `store.rs`
`Tx::commit` supplies the revision bump even for administrative writes. Raw SQL
edits of `_sessions` (or other authority facts) that bypass those revisions are
outside this contract, as for the G6/marker supported-binaries boundary. RI does
not independently reread or version each digest's session rows. Every revision
change misses; no cross-revision promotion is implied. This default decision is
not a new performance or publication qualification.

## Clients across rollback (SQLite)
Save versions/v1/schema.q (and any other .q modules with their original names) outside snapback/ and create `snapback/client-compatibility.json` containing `{"baseline":"versions/v1","since_release":2}`. `check`/`dev` emit added row/result fields as optional, labelled "Since release 2", retaining older result value domains. Required operation parameters remain required; only declared optional, defaulted or deprecated arguments may be omitted. Baseline generation warns about real old-client input breaks and changed/removed result domains; a declared table rename preserves reference input identity, and purely additive result fields print a RESULT NOTE. This is your release label, not server generation; ordinary types stay required without opt-in. Use `row.color ?? "none"` for the baseline fallback. Keep contemporary fixtures in versions/v1/fixtures/; deploy with `--schema versions/v1` and test with `--source versions/v1` (guide testing). Baselines resolve from the original project root, including saved-source deploys. `useRelease()` from snapback4/react follows the authenticated catalog even when query gates are closed: loading, denied, or `{generation, operations, tables}` with public argument/field shapes. Generated `api.op.available(release)` is false while unready or when name/kind/existing-argument signatures differ or the server adds a required argument; extra optional served parameters are compatible. This checks capability, not authorization or unchanged business semantics; still handle E_OP/E_INPUT and authored guard refusals when a switch races it. The SDK withdraws old metadata on observed generations, polls while subscribed, and returns loading offline/on catalog failure; account retirement/close withdraws it. Keep draft state above generation-sensitive read/action gates; remount only the gated children. Dormant means unavailable on this release, not deleted. Test v2 → v1 → v2 with one frontend: field fallbacks, missing operations, retained drafts and restored values. Alternatively check selected immutable source in a separate copy and rebuild its matching frontend. Preserve deployment source; Expo/Exact runtime changes also require a device rebuild.


## Trigger a deployed job (SQLite)
A running serve accepts `POST /jobs/<job>` with a full service token; the job executes as the system on its FIFO queue and server clock. Every full service seat can trigger system jobs, so provision these tokens only to trusted operators. Guest/account sessions, read-scoped tokens and personas cannot use this door. `POST /dev/jobs/<job>` remains development-only.
```sh
export SNAPBACK4_SERVICE_TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
bunx snapback4 run reconcile --release ./deployment --json
unset SNAPBACK4_SERVICE_TOKEN
```
`--token-env NAME` reads another environment variable. The command uses served source, so it also works outside the app directory. A lost reply is ambiguous; inspect the queue before retrying. Starter/client recipes: `guide client`.
Real-account production and its durable role/restart/rollback proof: `guide production`.


## Inspection, proxies and TLS (SQLite)

`data TABLE --release ./deployment --json` returns `{rows, more, limit}`. The default limit is 50; `more:true` means the snapshot was truncated. Increase `--limit N` to inspect more; `--limit 0` returns no rows and reports whether any exist. Non-JSON output remains one row per line. `snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json` returns positional rows under `columns`; `--json-objects` returns object rows with direct booleans and schema-proven media columns decoded to ordinary wire JSON. Positional `--json` retains tagged media text. Schema-qualified relations, recursive or shadowing/forward-reference CTEs need positional --json. A truncated JSON query reports its repair on stderr without corrupting stdout. Default `sql`, `data` and `releases` output also reports a nonzero dormant-row count on stderr; a missing active table names its retained rows and the concrete dormant query. `sql --dormant --release ./deployment` shows retained rows/cells, including removed tables; `sql --all-releases --release ./deployment` adds active images. `_snapback_state`, `_snapback_source` and `_snapback_columns` identify provenance and provided cells; these are retained images, not historical snapshots. Both modes are read-only; internal tables remain unavailable. Inspection bypasses read rules and can show expired stored rows; it is an operator tool, not an app query surface. Bind loopback behind a TLS proxy. Forward Authorization and preserve response bodies; allow long polls without buffering or early timeouts. Non-loopback HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS. Identity rate keys use the socket peer, not forwarded headers. Serve refuses personas and dev doors even through a local proxy; see SERVER.md for capacity. `--json-objects` returns `{header, columns, rows, limit, more, ruleFiltered:false}` with object `rows`; `--json` uses positional `rows`. Put flags outside the quoted SQL. N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. It groups root blockers with their dependents; persona-only schemas get one identity note. Add a service-seat insert mutation and provision real account relationships. E_UPGRADE means installation or post-upgrade check failed. Repair the package-manager or registry error and rerun upgrade. Packages may already be pinned: if check failed, repair the reported schema/device refusal and rerun check.

The default day-two proof hook returns explicit field changes for v1 writes. For a deliberate deletion return `{id:"table/id",fields:[],deleted:true}`: the row must be visible before the v1 callback, absent after it and stay absent on forward. Other persisted ids and values remain checked.

Selecting an already-live immutable id (or the target already served by its live
registered view) is an idempotent no-op. JSON returns `unchanged: true`, `release`,
`live`, `rowShape` and `message: "release N is already live"`; it records no event
and does not change revision, generation, pointer or receipts. `--check` retains
the complete preview response and changes no live state.

Guarded views preserve extracted v1 parent result fields through protected,
receipt-owned child anchors. The ordinary child lookup enforces current row and
column reads, uses the original child id even when different from the parent's,
and leaves the asset's home on that child. Missing/cleared payloads are null;
independent followups are never substituted. Inspect `rowShape` for changed
nullability and other domains. Old migration self-events remain visible in audit;
`guide rename` documents previewing and activating the bounded forward repair.

A filesystem source pointer without persisted live metadata is not an already-live
backend. Run one explicit `deploy DIR` to initialize it before serving or rollback.
