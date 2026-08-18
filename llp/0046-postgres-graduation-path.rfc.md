# LLP 0046: Postgres graduation path

**Type:** RFC
**Status:** Draft
**Systems:** Storage, Sync, Runtime, API, Deployment, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-23 (LLP 0079 SC-4: the dev-time Postgres open question gains a third option — embedded/child-process Postgres as the graduation-path test harness, with Serverpod's conceded tradeoffs and candidate mechanisms to evaluate; no decision claimed); 2026-07-07 (cross-family review revisions, ratified by Charlie — see
`reviews/0046-postgres-graduation-path.claude.md`: store-seam extraction named
as the prerequisite, cursor/version semantics fixed per 0007, DK-2 cited
instead of re-opened, atomic import and bundle exclusions restored; initial
same day)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0012, LLP 0018, LLP 0022, LLP 0032, LLP 0037, LLP 0038, LLP 0039

## Summary

This RFC defines the first Postgres graduation path. [LLP 0007](./0007-storage-portability.spec.md)
already defines the portability contract; this RFC chooses a buildable slice
that proves a Snapback app can move from SQLite to Postgres without rewriting
its schema, handlers, generated clients, or tests.

The first slice is a single-app Postgres target with commit fencing, the same
generated artifact shapes, and a conformance suite shared with SQLite — after
one prerequisite this document is honest about: the storage seam it plugs into
must be extracted first.

## Motivation

Snapback's scale-up claim includes SQLite at small scale and Postgres at larger
scale. Today Postgres is a design promise. The risk is not merely missing a
backend; it is allowing SQLite-specific behavior to harden into the app-facing
contract before a second SQL engine tests it ([LLP 0038](./0038-snapback-system-review.research.md)
Part 4 #8 makes the same point: portability is currently an untested promise,
prepared but unevidenced).

## Design

### Prerequisite: extract the store interface

There is no storage abstraction in the code today. `crates/snapback/src/storage.rs` is a
~2,300-line concrete rusqlite implementation — `rusqlite::Connection` in its
imports, `sqlite_path` in its serialized info shape — with no trait boundary.
LLP 0007 warns about exactly this in its Valet lessons: the single largest
retrofit cost was extracting a portable backend trait *after* consumers had
bound to a synchronous shape, and the portable interface "should be async and
transaction/lease-aware from the start."

So this RFC's first work item is not Postgres code: it is extracting the
async, transaction-aware store interface 0007 mandates, with the SQLite
implementation moving behind it unchanged in behavior. That extraction is the
largest single engineering cost in this document — and the strongest argument
for doing this now, because every month of local-target hardening makes the
retrofit more expensive.

### Target profile

Add a `postgres-dev` target profile:

- one logical app per database/schema namespace — choosing this pins the
  portable project/database handle representation that 0007 explicitly asks to
  have pinned "before the cross-engine handoff" (see Open Questions);
- the same app-facing schema manifest;
- the same function manifest;
- the same host-mediated query/mutation API;
- a target-specific storage adapter behind the newly extracted seam.

This target is not hosted multi-tenant Snapback by itself. One inherited
limit stated plainly: the live matcher runs in-process, so `postgres-dev` is
single-process realtime. Multi-process Postgres — the thing people ultimately
buy Postgres for — is the *next* seam after this one, out of scope here.

### Commit fencing

The write-path mechanism is already decided — 0007 DK-2 pins commit fencing as
the Postgres graduation default: allocate the version in a short critical
section at commit time, via a per-app advisory lock or a single-row
`UPDATE … RETURNING` version row, so version order equals commit-visibility
order (0007 property 3 — a mechanism that can expose a gap that later fills in
does not qualify, which is why bare sequences and plain serializable
transactions are not on the menu). The observable contract:

1. take the app write authority;
2. validate captured read dependencies;
3. allocate the next app stream version;
4. apply all row changes in one transaction;
5. publish or record the changeset for live subscribers.

What remains target-owned is only the measured choice *within* the fencing
shape: advisory lock versus `UPDATE … RETURNING` (see Open Questions).

### Schema translation

The adapter maps Snapback's portable field model to Postgres DDL through the
single-sourced normalization table 0007 requires — one generated table both
the writer and reader assert against, explicitly covering boolean, bytes, and
timestamps (0007 pins integer-millisecond timestamps: Postgres round-trips as
BIGINT milliseconds, not `timestamptz`, unless the mapping is documented in
the table). Unsupported schema constructs fail at load time with diagnostics.
The first slice supports the same field/index/query subset already proven on
SQLite.

Engine-specific features are opt-in only after LLP 0007 names the portability
cost.

### Migration and graduation

The first migration path is export/import, with three contracts 0007 demands
stated explicitly:

- **The bundle defines its exclusions.** Durable app data, durable identity
  facts, and the schema version are in; ephemeral sessions, verification
  codes, and secret values are out — the same exclusion list as
  [LLP 0039](./0039-auth-vertical-slice.rfc.md)'s export posture and
  LLP 0036's secret rules. "System tables" is not a sufficient description;
  the bundle enumerates.
- **Import is atomic-or-rejected.** 0007 flags atomic logical import as "the
  operation that makes 'graduate without a rewrite' true or false." A partial
  import failure leaves no half-populated target: the import either commits
  as a whole or fails with a structured diagnostic naming what was rejected.
- **Cursors do not survive graduation.** 0007 pins cursors as opaque
  `(stream, version)` pairs with cross-stream comparison undefined; a
  graduated instance is a new allocator and a new stream. Row `_version`
  values may be carried over as row data, but connected clients resnapshot:
  a live subscriber attached across graduation observes `resync_required`
  and re-enters with a fresh authorized snapshot. "Preserving versions" means
  the former, never continuity of the stream.

Concretely: export SQLite app data per the bundle contract; create the
Postgres schema; import atomically; verify row counts, ids, and indexes; run
the shared conformance suite. Live zero-downtime migration is out of scope for
the first slice.

### Test matrix

Every storage behavior test that claims portability must run against both
SQLite and Postgres. SQLite-only and Postgres-only tests are allowed, but must
say why. The shared suite includes the divergences 0007 names as the classic
SQLite↔Postgres traps: the concurrent-mutation test (two handlers read the
same invariant, only one commits), null ordering and pagination, and the
boolean/bytes/timestamp normalization assertions.

## Non-goals

- Hosted Postgres service selection.
- Horizontal write scaling.
- Cross-app transactions.
- Online migration with live clients attached.
- Multi-process realtime (named above as the next seam).
- Engine-specific query extensions.
- Replacing SQLite as the canonical local target.

## Acceptance

- The store interface is extracted; the SQLite target passes its existing
  suite unchanged behind it.
- The same generated todo app runs against SQLite and Postgres.
- A shared test suite proves ids, timestamps, indexes, read-set validation,
  commit versions, query results, live snapshots, concurrent-mutation
  behavior, and null-ordering/pagination agree.
- SQLite export/import into Postgres is atomic-or-rejected, preserves
  app-visible data (with `_version` carried as row data), and excludes the
  bundle's named exclusions.
- A live subscriber attached across graduation observes `resync_required` and
  re-enters with a fresh snapshot — cursor non-portability is tested, not
  assumed.
- Unsupported schema/query features fail with stable diagnostics.
- The capability manifest distinguishes SQLite and Postgres target profiles.

## Open Questions

- Within DK-2's fencing shape: per-app advisory lock or single-row
  `UPDATE … RETURNING` — which is simplest and measurably correct for the
  first adapter?
- One database per app, one schema per app, or a shared schema with app ids —
  and therefore what is the pinned portable project/database handle
  representation (0007's standing open question, which this choice answers)?
- Should local `snapback dev` start Postgres through Docker, connect to an
  existing URL, or both — **or a third option (added 2026-07-23, LLP 0079
  SC-4 per LLP 0078 R4/F3c): an embedded or child-process Postgres as the
  graduation-path test harness**, so agents can validate LLP 0007's
  portable-abstraction contract against real Postgres with no Docker
  dependency? Serverpod validated the child-process shape and its docs
  concede the tradeoffs to carry into the evaluation: tests may need
  serialized execution (their `--concurrency=1`), and ad-hoc DB access is
  coupled to a live process. Candidate mechanisms to evaluate — plan-added
  elaboration in LLP 0079, not from the Serverpod evidence, which validated
  only the child-process shape: a vendored `initdb`/`pg_ctl` child process,
  an embedded-Postgres crate, and PGlite-class wasm builds. Each candidate's
  evaluation must state whether it exercises **actual PostgreSQL server
  semantics** relevant to LLP 0007's conformance contract — a wasm build in
  particular may not count as "real Postgres" for graduation-path
  validation. The decision belongs to this RFC when the storage trait seam
  it depends on exists; nothing is decided here.

## Status

Draft. This RFC turns LLP 0007's portability contract into the first second-SQL
engine proof.
