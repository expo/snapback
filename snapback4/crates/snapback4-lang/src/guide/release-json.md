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
| selected | Present only with N/latest/current: {release, current (boolean), digest} for that immutable source |

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
with their private maintains are available. Missing change evidence
is `preserved: null` on `/changes`; certified changes/sync are excluded. Deploy
refuses `E_STORE_UNSUPPORTED` for assets beyond placement, jobs, actions, routes,
schedules, native programs, union sync, timed publication and row-keyed recounts. These runners and worker handlers
stay off. General schema evolution, rollback, previews, prune, staging, saved versions,
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
sources. An overflowing backfill rolls back the entire activation. Zero totals
remain sparse in stored images. Row-keyed view-recount remains refused.

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
