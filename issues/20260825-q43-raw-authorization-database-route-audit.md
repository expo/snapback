# Q43: the raw authorization-database boundary is open

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-auth, snapback-engine, snapback-server,
  snapback-activation, snapback-services, snapback-cli
Related: llp/0053-authorization-invalidation.rfc.md,
  llp/0225-core-modularization.decision.md,
  llp/0285-kernel-authorization-closure.spec.md,
  llp/0292-authority-straight-path.plan.md,
  llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260824-implementation-plans-remaining-p2-rows.md,
  issues/20260825-a-closes-rows-trailer-is-a-claim-not-a-label.md

## Verdict

**F084 is open.** Round 4 correctly observed that trigger SQL cannot authenticate a writer from
forgeable durable values, but incorrectly promoted a connection-local SQLite function into an
authorization capability. An application-defined function is a replaceable name on each
connection. A raw connection owner can register the same name, disable triggers, or write the
participating tables directly.

The reservation table, monotone epoch, and triggers remain useful consistency checks on
kernel-configured connections. They catch accidental direct DML and retain the genuine properties
already tested: the reservation is an `INTEGER PRIMARY KEY`, ordinary update/delete and
`INSERT OR REPLACE` are refused while triggers run, and no-op issuer paths consume nothing. **They
are defense in depth, not the boundary.**

The actual boundary would have to answer: who can obtain a writable connection or a writable
`LocalDatabase`/`ServingDatabase` view onto the authorization database? The current architecture has
several affirmative answers, including default production cells. The most fundamental one is that
the app and authorization state share the same caller-named SQLite file while
`LocalDatabase::open(path)` is a public cross-crate production API.

## Threat model used by this audit

This is the safe-Rust dependent-crate threat model used by the authority-surface programme. Features
are additive and unify across the dependency graph. `#[doc(hidden)]` is documentation policy, not
visibility. A public API under `test-support` remains callable whenever any graph edge enables that
feature.

The audit searched every workspace crate for:

- public constructors, return values, fields, aliases, re-exports, `Deref`, `DerefMut`, `AsRef`,
  `AsMut`, `Borrow`, `BorrowMut`, `From`, and `Into` involving `LocalDatabase`, `ServingDatabase`,
  `rusqlite::Connection`, `Transaction`, `ReaderPool`, and `DbRead`;
- public callbacks receiving any of those types or `LocalSnapback`;
- every `test-support`, `remainder-tests`, and benchmark-support surface;
- every production use that prevents simply reducing visibility.

The audit distinguishes acquisition from use. A public function that accepts the caller's own
`&mut Connection` or `&mut LocalDatabase` does not itself disclose the live instance's handle, but
it becomes relevant after any acquisition route succeeds.

## Complete route inventory

### Open acquisition routes

| Route | Cells / public paths | What the dependent obtains | Disposition and production need |
|---|---|---|---|
| Public low-level constructors | `snapback_kernel::storage::LocalDatabase::{memory,open}` in default and `test-support` | An owned writable `LocalDatabase`, including its authorization tables and public issuer-reservation operation | **Open; cannot be made crate-private in isolation.** Production callers cross crate boundaries from engine instance construction, CLI storage commands, services instance-fork work, and tools benchmarks. Rust has no friend visibility. The whole low-level construction/composition seam must move behind a different owner boundary. |
| Caller-known file path | The argument to public `LocalDatabase::open`, `LocalSnapback::open`, and `LocalSnapback::open_for_target`; `LocalDatabase::database_path`; `LocalDatabase::info().sqlite_path`; `LocalSnapback::database_path`; `LocalSnapback::inspect().storage.sqlite_path` | Enough information to call `rusqlite::Connection::open` independently on the same authorization database | **Open and fundamental.** Auth keyring/backup, engine startup, telemetry, instance-fork, and CLI/store-state production code use the path. Because auth and app data share the caller-named file, removing a handle accessor alone does not remove raw write access. |
| Serving adoption | `snapback_kernel::storage::ServingDatabase::{adopt,adopt_with_stream_attempt_verifier}` | An owned `ServingDatabase` after the caller constructs a `LocalDatabase` | **Open; production cross-crate composition.** Engine construction and services instance-fork adopt low-level databases. It adds no new route for a caller that lacked `LocalDatabase`, but completes the public writable-owner graph. |
| Mutable serving escape hatch | `ServingDatabase::auth_database_mut`, public and `#[doc(hidden)]` | `&mut LocalDatabase` for the exact live serving database | **Open; genuine production compatibility seam.** `LocalSnapback::execute_auth_plan`, `execute_auth_gc_plan`, invalidation installation, and other engine-owned auth choreography use it because `snapback-auth` cannot depend upward on engine and its sealed plans execute against `LocalDatabase`. Closing it requires moving those typed operations into kernel or changing crate ownership, not another SQLite check. |
| Shared `Deref` | `impl Deref<Target = LocalDatabase> for ServingDatabase`; there is no `DerefMut` | `&LocalDatabase`, including `database_path()` and shared methods; the path is enough to open a raw writer | **Open; compatibility residue.** It does not directly lend `&mut LocalDatabase`, but it is an acquisition route to the canonical path. LLP 0292 already calls for replacing inherited methods with explicit serving-owner methods; compile-driven migration is required. |
| Feature-public engine test accessor | `snapback_engine::test_support::auth_database_mut(&mut LocalSnapback)` when `snapback-engine/test-support` is unified | `&mut LocalDatabase` for the live engine database | **Open; no production need, and therefore an unresolved defect rather than an accepted seam.** There are 6 direct textual calls and 150 higher-rank `remainder_auth_database_mut` calls across server/CLI tests. “Test-only” is not a defense under additive features. It must be replaced by sealed typed test operations and deleted before F084 can close. Preserving those cross-crate acceptance tests is the immediate migration constraint, but it is not a production justification for the public route. |
| Unified server callback plus test accessor | Public `snapback_server::server::{SharedSnapback,with_snapback}` supplies `&mut LocalSnapback`; a graph that also enables `snapback-engine/test-support` can call the accessor above inside the callback | The same live `&mut LocalDatabase`, used before the callback releases the server lock | **Open by composition.** The callback itself is a production coordination primitive and does not expose storage in a default graph. The leak appears only because the additive engine feature publishes the accessor; deleting that accessor closes this composed route without deleting the callback. |

### Examined routes that are clean

| Candidate | Finding |
|---|---|
| Activation/server whole-storage aliases | **Closed this round.** `snapback_activation::storage` and `snapback_server::storage` are now crate-private imports. Their hostile-consumer fixtures reject the attempted mounts with `E0603` in default cells. Internal production code retains the crate-visible name it needs; CLI's one production import through the server alias moved to its existing direct kernel dependency. |
| Private `LocalDatabase::conn` | Clean. A dependent cannot project or borrow the stored `rusqlite::Connection`; the existing `obtain-writable-sql-handle` compile fixture fails with `E0616`. This does not stop an independent connection opened from the path. |
| `ServingDatabase` ownership traits | Clean except for the shared `Deref` above. There is no `DerefMut`, `AsMut`, `BorrowMut`, clone, `into_inner`, or conversion returning either database. |
| `DetachedReadSnapshot::as_database` | Clean for the live database. It returns only `&LocalDatabase` for a private, non-extractable in-memory copy with no path, no reader pool, and no serving adoption route. |
| `ServingDatabase::reader_pool` / `ReaderPool` | Clean. The returned `Arc<ReaderPool>` exposes `with_pinned_read`; `checkout`, `open_reader`, the idle `Connection` vector, `PooledReader`, and the one narrow vector-quarantine writer are non-public. Readers open with `SQLITE_OPEN_READ_ONLY` plus `query_only`. |
| `ReaderPool::with_pinned_read` and query-read callbacks | Clean. The callback receives `DbRead`, not `Connection` or `Transaction`; lifetimes prevent the view escaping. `PinnedDbRead.conn` and constructors are private. `DbRead::Live` can only wrap a `&LocalDatabase` the caller already has. |
| Auth transaction callbacks | Clean as acquisition routes. Every callback receiving `&Transaction` is `pub(super)` or `pub(crate)` in kernel. `AuthDatabasePlan` is public only as a sealed trait; dependent crates cannot implement it or construct the closure-backed plan. |
| Public `charge_local_authentication_attempts(&mut Connection, ...)` | Clean as acquisition. It mutates a connection supplied by its caller and neither discovers nor returns the live authorization connection. |
| Public auth/provider functions accepting `&mut LocalDatabase` | Clean as acquisition. They consume a handle the caller already possesses. They show why any handle leak is powerful, but do not create one. |
| `snapback` facade's hidden `storage` module | Clean. It re-exports only storage DTOs and migration/readback records, not `LocalDatabase`, `ServingDatabase`, `Connection`, or `ReaderPool`. Its hidden `local` module does expose `LocalSnapback`, including the path routes listed above. |
| `snapback-auth`, `snapback-engine`, `snapback-services`, `snapback-sync`, and CLI internal storage imports | Clean as re-exports: their storage imports are `pub(crate)`. Engine's separate feature-public accessor is the exception already listed. |
| `snapback-services/remainder-tests` | Clean as direct acquisition. It re-exports the `rusqlite` crate so higher tests can name the type, but publishes no victim path, pool checkout, or database handle. It composes with any separate path disclosure. |
| Connection reuse after callbacks/transactions | Clean. No public callback receives the live raw `Connection` or a mutable SQLite `Transaction`; no callback return can retain a borrow past its transaction. The public server callback returns after its `LocalSnapback` borrow ends. |

## Additive feature-cell result

| Crate mount | Default / owner cell | Additive support cells | Result |
|---|---|---|---|
| `snapback-kernel` | default | `test-support` | Open in both: public database types, constructors, serving escape hatch, shared deref, and path. The feature adds fixture operations but no second raw-handle accessor. |
| `snapback-auth` | default | `test-support` → kernel support | Its storage import is crate-private. Public provider APIs accept caller-owned database references; they do not disclose one. The unified kernel dependency remains directly open if the dependent mounts kernel. |
| `snapback-activation` | default | `test-support` | No acquisition route of its own in either cell. Its former whole-kernel `storage` re-export is now crate-private. Production functions accept database handles obtained elsewhere but do not disclose one. |
| `snapback-engine` | `engine-owner` | `test-support` → auth/runtime/sync support | Default exposes high-level `LocalSnapback` path routes but not its database field. Support is directly open through `test_support::auth_database_mut`. Hidden benchmark support returns `LocalSnapback`, not a low-level handle. |
| `snapback-runtime` | default | `test-support` | No storage type or SQLite re-export and no acquisition route. |
| `snapback-services` | `services-owner` | `benchmark-support`; `remainder-tests` → kernel support | Storage is crate-private. `remainder-tests` exposes only the `rusqlite` name. Production service code itself needs low-level open/adopt for instance fork, which is one reason the kernel constructors cannot simply become crate-private. |
| `snapback-sync` | `sync-owner` | `test-support` | Storage is crate-private. Public operations accept serving owners or typed views but return no database/connection. |
| `snapback-server` | `server-owner` | `benchmark-support`; empty `test-support`; dev graph enables engine/kernel/services support | Its former whole-kernel `storage` re-export is now crate-private. The public `local` re-export retains `LocalSnapback` and its path routes. The dev/unified graph additionally composes `with_snapback` with engine's test accessor. |
| `snapback-cli` | `cli-owner` | dev graph enables kernel/services support | Storage is crate-private to CLI callers, but production CLI code itself opens `LocalDatabase` for inspection, migration, recovery, and store-state operations. |
| `snapback-tools` | default | `telemetry-phase1-proof` | No re-export, but production-shaped benchmark code directly constructs `LocalDatabase`; this is another cross-crate kernel constructor caller. |
| `snapback` facade | default / empty owner labels | dev dependencies unify all support features in tests | Curated storage re-export is clean. Public hidden `local::LocalSnapback` retains the caller-known-path route. In its test graph, the separately mountable engine test-support accessor is enabled. |

Feature labels such as `engine-owner`, `server-owner`, and comments saying a surface is not shipped do
not create exclusivity. Any dependent graph can request additive features, and Cargo selects their
union.

## What F084 actually requires

F084 asks who may instantiate an `ObligationRegistry` for a particular issuer,
authorization incarnation, and data-version stream. The Rust factory now does the right local
derivation: `ObligationRegistry::new` consumes a non-`Clone` `LiveInvalidationIssuer`, and derives
all three axes from that installed issuer instead of accepting a caller-built
`ObligationExpectation`.

That signature closes only the final factory step. F084 closes end to end only when a dependent
cannot obtain or synthesize the producer input for the victim database. Concretely, the refusal must
show that the dependent cannot:

1. obtain the live database's mutable `LocalDatabase`/`ServingDatabase` view and call the public boot
   reservation path;
2. open an independent writable connection to the same authorization database and replace the
   durable producer facts that make an issuer current;
3. reach either route in any additive feature combination, re-export, callback, pool, transaction,
   or test-support surface.

The current tree fails items 1–3. The same-name function attack now has an executable regression and
**succeeds**, retiring the legitimate issuer. Therefore this lane carries no `Closes-rows: F084`
trailer.

## Required design decision

This cannot be repaired with another table, trigger, function, MAC checked by a function, or canary.
The raw connection owner controls the interface that would check all of them.

There are two honest architectural choices:

1. Narrow the programme's threat model to trusted database owners. Then F084 can classify the Rust
   derive step as closing caller-supplied registry axes, while explicitly excluding raw SQLite
   owners; the reservation machinery remains defense in depth and raw-owner sabotage is not a row
   refusal.
2. Keep raw dependent connections in scope. Then the authorization store needs a real capability
   boundary outside SQLite: for example, a broker/process that alone opens the authorization file,
   or a storage split whose authorization database path/descriptor is never given to dependent
   crates. The public low-level constructors, path projections, serving escape hatch, shared deref,
   and feature-public test accessor must be removed or redesigned around typed operations. The two
   whole-module re-export aliases found by this audit have already been narrowed to crate visibility.

Under the current shared-file, same-process public embedding API, choice 2 is not yet implemented.
F084 remains open.

## Upgrade availability correction

The predecessor binary stored only `_snapback_meta.auth_invalidation_boot_sequence_v1`. The round-4
binary added empty reservation/issuance/epoch infrastructure, then rejected that exact migrated
shape because sequence and issuance did not appear together.

The corrected reader accepts only this predecessor shape:

```text
sequence = Some
issuance = None
reservation = None
epoch = None
```

It uses the predecessor sequence as the high-water and atomically writes the complete next
reservation, sequence projection, issuance projection, and epoch. Any missing projection after a
successor-only reservation or epoch exists remains corruption and fails closed. This is upgrade
compatibility, not automatic repair of raw-owner poison.

Verification includes a focused synthesized-shape regression and a cross-version run in which the
actual pre-change commit `abee210f1e434094ee6047aa86ad7334af4a3666` creates/reserves sequence 1
and the current commit reopens it and reserves sequence 2.

## Verification record

- After rebasing onto `origin/main`,
  `cargo test -p snapback --test auth_invalidation_boot_replay_v1 -- --nocapture` passed 8 tests
  with 1 cross-process helper ignored. The same-name function attack committed sequence 2 and
  retired the live issuer; the unconfigured raw-DML case remained refused; the legacy projection
  graduated successfully.
- The retained round-5 upgrade evidence covers five database shapes: an `abee210f1` sequence-1
  database reopening and reserving 2; a database from `23a46716b` doing the same; a sequence-free
  older database starting at 1; a partial infrastructure state with the reservation table already
  present; and open-migrate-exit-before-first-use followed by reopen and reservation 2.
- `cargo check --workspace --all-features`: passed, covering the additive union as well as the
  already-run default focused test.
- The activation and server hostile expressions both reached `E0603` at their former `storage`
  mounts. Their source witnesses remain in the fixture tree but are deliberately unregistered: the
  privilege scanner certifies both crates as empty, so mounting them as fixture dependencies would
  itself violate LLP 0284 I-12's empty-surface invariant.
- `node scripts/check-security-boundaries.mjs` measured exactly 12 violations, matching the reviewed
  `origin/main` baseline, with no activation/server empty-surface violation: 2 missing seed-command
  inventory witnesses and 10 expected-red attacks (`admit-system-push`,
  `admit-protected-record-erasure`, `admit-pending-effect-creation`,
  `admit-pending-effect-refusal`, `service-interlock-factory`, `services-rusqlite-reexport`,
  `obtain-promotion-contention-reservation`, `obtain-ask-spend-reservation`,
  `forge-membership-writer-admin`, and `construct-authorization-view`).
- After regenerating the diagnostic, symbol, and Guide projections,
  `node scripts/check-inventories.mjs` passed (356 package tests, 31 script tests, 31 demos, 487
  publication leaves, and 157 Guide pages / 1,872 snippets). `./ref-check --verbose` passed with 0
  errors and 0 unchecked references.
- The rebased immutable-transcript input is effective:
  `node scripts/check-guide-asset-client-example.mjs` passed its packed runtime, typecheck, and
  raw-client sweep with 13 allowlisted files. `node scripts/check-guide.mjs` then passed all 22
  checks; there is no benchmark-transcript raw-client failure in the integrated measurement.
