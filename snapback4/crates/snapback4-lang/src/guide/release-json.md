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
transactions remain token-fenced. Startup cleanup matches store id, token and
holder, even after renewal loss. A known rolled-back claim attempts no release;
an unknown claim COMMIT retains cleanup identity without write authority.
Successful cleanup permits immediate corrected
startup; otherwise retry after expiry. Once serving, serve leaves the lease to
expire about three seconds after its last renewal, including on clean shutdown; deploy releases it after its fenced activation finishes. Doctor reports backend,
logical identity, owner token/holder and database-clock lease state without raw SQL.
SQL inspection currently refuses `E_STORE_UNSUPPORTED`. An unknown activation
COMMIT is resolved from persisted selection, without replaying activation; an
unresolved result keeps its exact source for recovery.

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

For a single-owner Linux Postgres deployment, zero-flight revision-cache hits are opt-in through `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms`. These numbers declare a guarantee: during any grant, database time advances at most `(1 + rate_ppm/1000000) * CLOCK_BOOTTIME_elapsed + forward_jump_ms`, including suspend and every supported failover. They are not tuning estimates. For example, `1000,250` declares a maximum 0.1% relative rate excess and 250 ms cumulative forward adjustment; the three-second grant gets a local deadline below 2.747 s. Use this only when the deployment guarantees those bounds and all writers run the grant-aware protocol. Unset it for arbitrary clock steps, unqualified failover or mixed versions, and do not use it across VM pause/migration longer than the lease. Explicit malformed or non-UTF-8 bounds refuse startup. The ordinary one-statement G5 validation remains the default. Serve startup and doctor print cache diagnostics. Serve reports its local startup tier; doctor reports the owner's persisted grant and clock declaration, with local activity explicitly unconfirmed: reconnect or local revocation can fall back to G5 before the persisted grant expires. Doctor does not use its own environment for that status. Opt-in is the default posture even with `ha=none`. Revisit default-on only after the roughly one-second G6 stall is explained, G5-versus-G6 write cost is measured, a durable compatibility marker makes pre-G6 binaries refuse grant-enabled stores, and Snapback can witness the clock contract instead of assuming it. A grant hit rechecks bearer authority and expiry with a fresh clock. Every local commit invalidates revision equality. Grant loss falls back to database reads; unknown COMMIT stops cached reads and new writers until fenced reacquisition with a fresh process/epoch. Graceful release drains cached reads first.
