# LLP 0311: Bind the authorization interlock to the database resource

**Type:** RFC
**Status:** Draft
**Systems:** Authorization, Storage, Kernel, Sync, Engine, Server, Test support,
Operations
**Author:** Codex / Charlie Cheever
**Date:** 2026-08-25
**Revised:** 2026-08-25
**Related:** LLP 0053, LLP 0059, LLP 0291, LLP 0303,
[`issues/shelved/20260825-a-second-database-handle-publishes-without-the-interlock.md`](../issues/shelved/20260825-a-second-database-handle-publishes-without-the-interlock.md),
[`issues/shelved/20260825-no-in-database-mechanism-defends-against-a-raw-connection.md`](../issues/shelved/20260825-no-in-database-mechanism-defends-against-a-raw-connection.md)

## Summary

The reported defect is real, but its effect on the rows closed so far is
smaller than feared.

`AuthorizationInterlockState` is entirely a fact about one `LocalDatabase`
handle. Every constructor initializes it to `Disabled`; the commit helper
interprets `Disabled` as "reservation not required"; and a second handle for
the same SQLite database can therefore publish an authorization event without
binding the participant used by the first handle. No current read or write of
the interlock state is resource-enforced.

That defect directly reopens **none of F157, F171, F172, F173, F175, F188,
F190, F191, C005, C009, F094, or F143**. Those closures reject a mismatched
carrier, issuer graph, or `DatabaseBinding` at the consuming operation; they do
not rely on `AuthorizationInterlockState`. F182 is different: a handle opened
before an agents-mode activation retains `self.schema`, and
`register_agent_principal_with_class` derives the mode from that cached schema
inside a later transaction. F182 therefore does not survive every two-handle
schedule. That is the same resource-versus-acquisition shape, but it is an
independent schema-cache defect, not a consequence of the interlock's
`Disabled` state.

This RFC recommends a combination of two mechanisms:

1. a durable `authorization_publication_guard_v1` record, read in every
   authorization-publication transaction, that makes a prepared participant
   binding mandatory for an operational database; and
2. a resource-level, crash-releasing publication lease plus an in-process
   resource coordinator, acquired before any Snapback/SQLite/runtime lock,
   that gives all publishing handles for one database one participant graph.

The durable record is the safety authority. The lease is coordination, not a
cached substitute for the record. `Disabled` ceases to be a state of a handle
that can publish. Bootstrap, import, recovery, and test fixtures become named
operation modes with narrower capabilities; they are not alternative
spellings of `Disabled`.

Confidence in the architectural recommendation is **0.82**. The least certain
part is the minimal protected-write footprint for a SQLite authorizer: making
it too narrow leaves a semantic producer outside the gateway, while making it
too broad turns ordinary identity/session maintenance into unnecessary room
quiescence. The implementation design must settle that footprint from LLP
0053's four-event predicate before code is changed.

## 1. Question and scope

This document answers four questions:

1. Where is the current interlock read or written, and is each use a property
   of the resource, the handle, or neither?
2. Which already-closed authority-correlation rows survive a separately opened
   handle for the same database?
3. Which design makes guardedness a database fact without violating LLP 0059's
   lock order or turning an incorrect guard into an unrecoverable outage?
4. Which current public producers remain outside the guarded publication path,
   including surfaces exposed only by the additive `test-support` union?

The enumeration is over both the default graph and the additive union in which
`test-support` is unified across auth, engine, kernel, sync, types, and server.
Dependent-reachable `cfg(feature = "test-support")` functions count as public
surface. A seam gated by `cfg(test)` alone is unit-only and is recorded as such
rather than promoted to production reachability.

The census counts **producers of durable effects**, not merely callers of a
function that was inspected. Checked-in tests are evidence of composition: a
fixture called directly by a dependent crate is live additive surface even if
no production route calls it under default features.

The governing event universe remains LLP 0053's closed four-event predicate:

1. a permission-backing write;
2. schema, function, or authorization-metadata activation;
3. reset, import, or restore; and
4. out-of-band permission revocation.

This RFC does not broaden that predicate. It changes where the fact "this
database requires an interlocked authorization publication" lives and how all
four event classes enter the one guarded transaction path.

## 2. Current-state census

### 2.1 Result

There are **zero resource-enforced reads or writes of
`AuthorizationInterlockState`**. The durable authorization version,
`DatabaseBinding`, predecessor, witness, and projection checks performed after
a reservation has been selected are resource-correlated checks, but none makes
the selection of the interlock mandatory. Guardedness remains an attribute of
the handle that reached those checks.

The census below groups repeated reads in one function or one lifecycle
transition. It excludes assertions inside unit tests from the production
count, then records their evidentiary value separately.

### 2.2 State construction and lifecycle

| State access | Locations | Classification | Consequence |
|---|---|---|---|
| Construct `LocalDatabase::memory` as `Disabled` | `storage.rs:3027-3045` | Handle only | An in-memory publishing handle starts optional. |
| Construct `LocalDatabase::open` as `Disabled` | `storage.rs:3069-3115` | Handle only | Every separately opened file handle forgets the first handle's participant. This is the reported bypass. |
| Construct `detached_read_snapshot` as `Disabled` | `storage.rs:3339-3361` | Handle only, but non-publishing by public contract | Harmless only while the detached snapshot remains non-extractable and read-only. It must become a distinct non-publishing type, not an accepted `Disabled` publisher. |
| Read `Disabled`, write `ParticipantPending` | `take_authorization_commit_participant`, `storage.rs:2052-2069` | Handle only | Enrollment is opt-in per handle. |
| Read `ParticipantReady`, write replacement `ParticipantPending` | `replace_authorization_commit_participant`, `storage.rs:2082-2124` | Handle only | Replacement coordinates one enrolled handle, not the resource. |
| Read `ParticipantPending`, write `ParticipantBound` | `bind_authorization_commit_participant`, `storage.rs:2137-2160` | Handle only | The later `DatabaseBinding` check is exact, but an unenrolled sibling never performs it. |
| Read `ParticipantBound` or `ParticipantReady` | `authorization_expectation_view_for_participant_install`, `storage.rs:2168-2191` | Handle only | The durable expectation is installed for one participant lifecycle. |
| Read `ParticipantReady`/`ParticipantBound`, write `ParticipantReady` | `activate_authorization_commit_participant`, `storage.rs:2202-2269` | Handle only | Activation proves that handle's issuer projection; it does not mark the database as guarded. |

### 2.3 Reservation predicates and binding

| State access | Locations | Classification | Consequence |
|---|---|---|---|
| Map `Disabled` and `ParticipantBound` to `false`; validate pending/ready states | `AuthorizationInterlockState::authorization_commit_reservation_required`, `storage.rs:1556-1609` | Handle only | `Disabled => false` is the direct fail-open branch. `ParticipantBound => false` is safe only during the one handle's staged activation protocol. |
| Expose the predicate from `ServingDatabase` | `storage.rs:1784-1787` | Handle only | The serving wrapper forwards the embedded handle's answer. |
| Skip preparation when no event or when the predicate is false | `prepare_authorization_commit_interlock`, `storage.rs:1072-1107` | Handle only | An event on a `Disabled` sibling yields `None`. |
| Commit normally when preparation is `None` | `commit_with_prepared_authorization_interlock`, `storage.rs:1109-1135` | Not enforced for that publication | SQLite commits and the authorization version advances without a participant bind. |
| Require `ParticipantReady` and bind reservation to registry generation, `DatabaseBinding`, predecessor, witness, and impact | `room_authority.rs:1137-1218` | Handle only for guardedness; resource-correlated after selection | Strong binding cannot compensate for a sibling that selected no reservation. |
| Ask whether staging is required in sync | `sync/src/ephemeral.rs:9427,9456` | Handle only | A sibling `Disabled` handle suppresses staging. |
| Take, bind, activate, or replace the participant in sync | `sync/src/ephemeral.rs:3497-3502,3568,3655-3664,9485,9730` | Handle only | The lifecycle is attached to the `ServingDatabase` passed into the coordinator. |
| Ask whether staging is required at the server writer gate | `server/src/server/writer_gate.rs:555,718` | Handle only | The outer gate repeats the same optional answer; it is not an independent resource guard. |
| Ask through the engine wrapper and acceptance paths | `engine/src/local/engine.rs:10278,24936-24937,31996`; `engine/src/local/auth_room_kick_acceptance.rs:1720,1871,1894` | Handle only | These checks correctly constrain the participating engine and still cannot observe a separately opened handle. |

### 2.4 Writers that clone and consume the state

Every path in this table clones `self.authorization_interlock` before opening
or committing its transaction. Every one is therefore **enforced on the
handle only**.

| Writer family | State-read / prepare / commit locations |
|---|---|
| Mutation-plan lifecycle | `storage.rs:5012,6377-6385,6416` |
| Buffered-write lifecycle | `storage.rs:6694,7334-7342,7371` |
| Auth-catalog activation | `storage/auth.rs:1534,1546-1552` |
| Auth restore declaration | `storage/auth.rs:2080,2187-2193` |
| Logical auth import | `storage/auth_logical_transfer.rs:206,378-384` |
| Staged auth-mode transition | `storage/auth_mode.rs:268,333,596-633` |
| Session-consuming auth-mode transition | `storage/auth_mode.rs:877,962-968` |
| Dev-downgrade consumption | `storage/auth_mode.rs:1019,1084-1090` |
| Same-mode deployment | `storage/auth_mode.rs:1178,1274-1287` |
| Network deployment with functions | `storage/auth_mode.rs:1367-1397` |
| Mode-aware schema application | `storage/auth_mode.rs:1623,1670-1676` |
| Reset and seed | `storage/schema_seed.rs:506,562-565` |
| Versioned seed reset | `storage/schema_seed.rs:654,701-704` |
| Ensure versioned seed | `storage/schema_seed.rs:787,956-965` |
| Seed with authorization | `storage/schema_seed.rs:1154,1191-1200` |

Unit tests in `storage/room_authority.rs:2343-3040` and
`storage/tests.rs:13097-13135` read and mutate the same handle state. They prove
the enrolled-handle lifecycle well, including substitution and stale
projection refusals. They do not contain the missing two-handle fixture and do
not make any state resource-level.

### 2.5 Unguarded producers

The producer census found the seven categories named by the issue. None reads
`AuthorizationInterlockState`; each is therefore **not enforced**. Section 6
gives the per-producer disposition and two corrections to the issue's grouping.

## 3. Blast radius across closed rows

### 3.1 Decision rule

A row survives the second-handle schedule when the subject/authority
correlation is re-established by the consuming operation from a durable
resource identity, an opaque carrier bound to an exact `DatabaseBinding`, or
an exact issuer/engine graph. It does not survive merely because the handle
that usually reaches it has a participant.

The result distinguishes:

- **directly reopened by this interlock defect**: the row's safety claim needs
  `AuthorizationInterlockState` to be enabled on the operating handle; and
- **fails another two-handle schedule**: the row has an independent
  acquisition-time cache or resource-binding gap.

### 3.2 Per-row result

| Row | What the closure binds | Survives a separately opened handle? | Finding |
|---|---|---|---|
| F157 | The admitted origin graph carried by the opaque operation | **Yes** | A second database handle does not manufacture the required graph identity. The origin mismatch is refused at the consumer. No dependency on interlock state. |
| F171 | Target engine graph | **Yes** | The target-engine check is performed on the operation's bound graph, not inferred from the publishing handle. |
| F172 | Target engine graph | **Yes** | Same proof shape as F171; the sibling handle does not make a foreign target graph equal. |
| F173 | Target engine graph | **Yes** | Same proof shape as F171/F172. |
| F175 | Production type surface; additive synthetic construction removed or compile-refused | **Yes** | Feature unification does not restore the removed portable carrier. A sibling `LocalDatabase` is not a carrier constructor. |
| F188 | Target engine graph | **Yes** | Exact graph mismatch remains detectable at use. |
| F190 | Target engine graph | **Yes** | Exact graph mismatch remains detectable at use. |
| F191 | Target engine graph | **Yes** | Exact graph mismatch remains detectable at use. |
| C005 | Opaque subject-bearing authority, `AdmissionLeaseOrigin`, and exact `DatabaseBinding` | **Yes** | The consumer rejects a carrier from another database/authority graph. The closure did not introduce or rely on durable interlock state. |
| C009 | Installed invalidation reservation bound to its issuer connection/history and exact effect fence | **Yes** | A separately opened database has a distinct issuer reservation history; it cannot mint the installed carrier accepted by the first graph. This state is process-local but the row is issuer-scope correlation, not authorization-publication serialization. |
| F094 | `AuthCoordinator` derives source and `DatabaseBinding` from the same receiver; raw projection rebuild is not a portable public carrier | **Yes** | A sibling cannot pair an arbitrary raw source with the first database's admitted coordinator. |
| F143 | Same opaque carrier/origin/target-binding family as C005 | **Yes** | The consuming route rechecks the carrier's subject and target rather than trusting interlock enrollment. |
| F182 | Agent mode derived from `self.schema` in `attempt_auth_transaction_with_schema` | **No, for a long-lived pre-activation handle** | The API no longer accepts caller-selected `AgentsMode`, and partial primitives are private, but a handle opened while mode is `Open` retains that cached schema after another handle activates `Disabled`. It can later derive stale `Open` inside its transaction. A freshly opened post-activation handle is safe. This is not caused by `AuthorizationInterlockState`; F182 needs a resource-derived in-transaction mode read. |

### 3.3 Blast-radius conclusion

The interlock issue directly reopens **0/8 measured rows and 0/5 claimed
rows**. Under the broader question "does every claimed closure survive every
same-resource two-handle schedule?", **F182 requires re-closure for a separate
reason**. The programme should record that distinction rather than crediting
the interlock design with fixing F182 automatically.

This narrow result does not reduce the priority of the interlock defect. The
interlock governs publication ordering and room invalidation, whereas the
listed rows mostly govern carrier provenance. They are adjacent safety layers,
not alternate implementations of one layer.

## 4. Requirements

The replacement must satisfy all of the following.

**R1 — resource fact.** Whether authorization publication requires a
participant is a durable fact of the database resource, not a constructor
default or acquisition-time cache.

**R2 — per-use observation.** The fact is read inside the same SQLite
transaction as the protected effect. Reading it only at `open`, lease
acquisition, or participant installation is not sufficient.

**R3 — one participant graph per publishing resource.** All publishing
handles in one process share one resource coordinator; a second process cannot
publish concurrently under a different participant graph.

**R4 — no `Disabled` publisher.** A handle capable of beginning a protected
publication cannot represent `Disabled`. Bootstrap, maintenance, recovery,
import, and fixture construction have separate capability types and durable
preconditions.

**R5 — closed connection and transaction gateways.** Every Snapback-owned
writable connection to an operational database is acquired through one
connection factory that installs the protected-write enforcement. No public or
feature-gated helper may open a path directly for writing. On such a
connection, an ordinary transaction cannot write the LLP 0053 protected
footprint. Only a transaction that has re-read the durable guard and bound a
prepared reservation can do so. The rule applies unchanged under the additive
`test-support` union.

**R6 — LLP 0059 lock order.** Projection, stream, session, room, notifier, and
resource-coordinator locks are not acquired while holding `LocalSnapback`, a
SQLite writer, or a transaction. Waiting for the resource lease also occurs
outside those locks. The follow-on spec assigns the resource coordinator an
explicit rank and proves every edge; "outside" prose is not the rank proof.

**R7 — fail-closed with recoverability.** A missing, corrupt, or contradictory
guard cannot fall back to unguarded publication. It can still open read-only
for diagnosis and must have an owner-authorized, offline-exclusive repair path.

**R8 — no absorbing guard counter.** The publication guard does not use a
bounded monotone integer whose maximum permanently poisons the database. Its
identity is a random incarnation changed only by explicit transition.

**R9 — producer-complete proof.** Acceptance enumerates default and additive
producers, including every `Connection::open*` site, and includes direct
checked-in fixtures for a second handle, a second process, each lifecycle mode,
each path-opening maintenance/fixture producer, and each test-support producer
family.

**R10 — explicit file-access threat boundary.** A SQLite authorizer, trigger,
or application-defined function cannot authenticate a hostile party that can
open the database file with an arbitrary raw writable connection: that party
controls its own connection configuration and can ignore an advisory lease.
The resource guard protects all supported Snapback writers. Deployment must
restrict raw file write access to that fleet. Arbitrary external SQLite writers
are outside this mechanism's threat model and are never described as
automatically refused.

## 5. Alternatives

### 5.1 Alternative A — durable guard, read per use

Store an `authorization_publication_guard_v1` record in the database. A
protected transaction begins `IMMEDIATE`, reads the record, verifies that it
is `Operational`, checks the database binding and guard incarnation on its
prepared reservation, performs the effect and authorization-version update,
and commits both together.

**What it fixes.** A separately opened supported handle sees the same `Operational`
requirement. It cannot interpret a constructor default as permission to omit a
participant. A stale acquisition-time answer is irrelevant because the guard
is read again in the effect transaction. With a closed transaction gateway,
the handle-based members of the seven current bypass families fail closed even
when `test-support` is unified. Path-opening members do so only after they are
removed, demoted, or routed through the connection gateway.

**What it does not fix alone.** It does not decide which of two processes owns
the live room/issuer graph. Both can read the same durable record and each can
try to bind a different process-local participant. It also does not, by
itself, refresh other cached policy such as F182's `self.schema`. Finally, a
code-level helper is not producer-complete if raw transactions can still write
the protected footprint. A connection-local authorizer cannot constrain a
path-opening helper that omitted it, an older binary that does not install it,
or an arbitrary external SQLite connection.

**Failure mode.** A false `Maintenance` state, corrupt record, or incorrectly
classified protected write becomes **permanent denial of authorization
publication**. If opening requires publication, the database can appear
unopenable. This is the inverted harm required by LLP 0303: the guard's false
refusal is worse operationally than the current gap, even though it is safer
for authority.

**Migration cost.** High. Existing databases need a one-time exclusive
inspection and guard installation. Protected transaction constructors and
commit sites must be typed; a connection-level authorizer or equivalent must
deny protected writes outside the typed transaction. Direct fixture writers
and every path-opening writable helper must migrate or be demoted to unit-only.
Missing markers on non-empty databases cannot mean `Disabled`. Rollout also
requires an exclusive fleet cut: a pre-guard binary must not retain raw write
access after migration.

### 5.2 Alternative B — make `Disabled` unreachable for publishers

Split `LocalDatabase` into non-publishing and publishing capabilities. A
publishing capability is constructible only after a participant is installed;
ordinary `open` returns a non-publishing handle, and the old `Disabled` variant
is removed from the publishing state machine.

**What it fixes.** Within one well-typed process, accidentally using a freshly
opened handle on a guarded writer becomes a construction error or a runtime
refusal. It is the smallest API change that removes today's explicit
`Disabled => false` branch.

**What it does not fix.** Without a durable database fact, a second binary,
older library, raw connection, or separately constructed process can still
decide that its handle is a publisher and install its own participant. It also
does not stop a feature-gated public writer that bypasses the publishing type.
On its own this is a spelling change, not a resource-level fix.

Legitimate non-participating operations do exist: creation of an empty
database, offline import/restore, collision repair, and construction of
synthetic fixtures. The correct distinction is not "this handle may be
Disabled". It is "this operation has a named capability, proves an empty or
offline-exclusive resource state, and cannot be used by a serving publisher."

**Failure mode.** An enrollment bug makes every publishing capability
unconstructible. If an escape hatch recreates `Disabled`, the original gap
returns; if it does not, the database is publication-dead until the process
can rebuild its participant.

**Migration cost.** Medium for APIs and call sites, low for existing database
files if used alone. Bootstrap and fixture APIs break. The low file-migration
cost is also evidence that no resource fact has been added.

### 5.3 Alternative C — resource publication lease/advisory lock

Require a handle to hold a resource-level publication lease before it can
publish. Use an OS-backed, crash-releasing cross-process lock and an in-process
registry keyed by exact database identity so process-scoped or re-entrant file
lock semantics cannot admit two local coordinators. All handles for that
resource borrow the one coordinator and participant graph.

Lease acquisition and any wait occur **before** taking `LocalSnapback`, a
SQLite writer/transaction, projection topology, stream, session, room, or
notifier locks. While a transaction is open, the code performs only a
non-blocking assertion against an already-held, unforgeable lease carrier; it
never acquires or waits for the lease. Reservation/quiescence is staged before
the SQLite transaction, and settlement remains after commit. This respects
LLP 0059 §"Locking and coordination rules".

**What it fixes.** Cooperative Snapback processes cannot serve two independent
participant graphs for one resource. A second local handle either joins the
existing resource coordinator or is non-publishing. A process crash releases
the OS lease.

**What it does not fix alone.** A lease checked only at acquisition is still a
cache. It does not tell an already-admitted handle that the durable database
entered maintenance, nor does it constrain a raw/unleased SQLite writer. File
lock behavior differs by platform and filesystem; network filesystems may not
provide the required semantics. A lease also cannot decide whether a write is
one of LLP 0053's four events. An arbitrary external writer can ignore an
advisory lease; the lease is exclusion among cooperating Snapback processes,
not a file-access security boundary.

**Failure mode.** A falsely live lease, unsupported filesystem, in-process
registry leak, or stale sidecar can deny all publishers. Blindly deleting the
sidecar would invert the failure back into concurrent publication. The safe
response is read-only quarantine plus lock-owner diagnosis; only a verified
orphan may be cleared.

**Migration cost.** Medium. No durable schema change is strictly required, but
every publishing process and direct writer must acquire/assert the lease.
Serving on filesystems without proven advisory-lock semantics becomes
unsupported or read-only. Tests need isolated paths and explicit lease
lifetimes.

### 5.4 Comparison

| Alternative | Second handle | Second process | Detects durable mode change per use | Closes raw protected writer | Existing-DB cost | Principal risk |
|---|---:|---:|---:|---:|---:|---|
| A. Durable per-use guard | Yes | Refuses, but cannot choose one live participant alone | Yes | Yes, with a closed gateway | High | Poisoned guard causes permanent denial |
| B. No `Disabled` publisher | Yes, for typed callers | No | No | No | Low file / medium API | Escape hatch recreates gap, or enrollment failure denies all |
| C. Resource lease | Yes | Yes, for cooperative processes/filesystems | No | No | Medium | False/stale ownership denies all |
| **A + B + C** | **Yes** | **Yes** | **Yes** | **Yes** | **High** | **Fail-closed denial requires an explicit repair lane** |

## 6. Recommended design

### 6.1 Decision

Adopt **A + C**, using B as the public type shape rather than as the safety
authority.

The durable record answers "what must every publication of this database do?"
The lease answers "which live resource coordinator owns that duty?" The type
split prevents ordinary code from spelling the old bypass. None substitutes
for the others.

### 6.2 Durable record and states

Add one database-owned record with this conceptual shape:

```text
authorization_publication_guard_v1 =
  Operational {
    guard_incarnation: random 128-bit identity,
    format: 1
  }
| Maintenance {
    guard_incarnation: random 128-bit identity,
    operation_id: random 128-bit identity,
    kind: Import | Restore | Repair | EpochRollover,
    predecessor_digest: 256-bit digest
  }
```

There is no durable `Disabled` value. Absence is valid only during creation of
a provably empty database, in the same exclusive transaction that installs the
initial schema, authorization version, and `Operational` record. Absence on a
non-empty or legacy database means "migration required" or "quarantine", never
"publication optional".

`guard_incarnation` is random, not incremented, so the guard has no maximum.
Changing it invalidates every prepared carrier. A maintenance operation either
returns to `Operational` with a fresh incarnation or leaves an auditable
`Maintenance` record for recovery.

### 6.3 Resource coordinator and capability types

Opening a database yields a read/non-publishing handle. Claiming publication:

1. resolves an exact resource identity without trusting a caller string;
2. joins or creates the process-local coordinator for that identity;
3. acquires the cross-process lease without holding any LLP 0059-prohibited
   lock;
4. reads the guard for admission only as an early diagnostic, not as the
   per-use authority;
5. installs and activates one room-authority participant; and
6. returns a `PublishingDatabase` capability that borrows the coordinator.

A second handle for the same resource joins that coordinator and cannot obtain
a fresh `Disabled` state. A second process cannot obtain the publication
lease. A detached snapshot is a distinct read-only type. Import, restore,
repair, and rollover use an `OfflineMaintenanceDatabase` capability requiring
the exclusive lease, no listener, no active room participant, and a durable
maintenance declaration.

The exact cross-platform lease primitive is an implementation decision, but
acceptance requires crash release, independent-process exclusion, and explicit
negative tests on every supported filesystem class. If those semantics cannot
be proven, publication on that filesystem is unsupported; it must not silently
fall back to handle-local coordination.

### 6.4 Per-publication choreography

The normative order is:

1. Outside `LocalSnapback`, SQLite, and all projection/stream/session/room/
   notifier locks, the resource coordinator stages the impact, reserves and
   quiesces affected rooms, and creates an opaque prepared carrier.
2. Acquire the SQLite writer and begin `IMMEDIATE`.
3. Read `authorization_publication_guard_v1` in that transaction. Require
   `Operational`; require the carrier's exact `DatabaseBinding`, guard
   incarnation, resource-coordinator identity, registry generation, durable
   authorization predecessor, witness, and impact to match.
4. Enable the connection's protected-write capability for this transaction.
   Perform the effect and authorization-version transition.
5. Recheck the durable predecessor/successor and commit.
6. Drop the SQLite writer before taking any coordination lock. Publish or
   cancel the prepared reservation and settle rooms outside the transaction.

No step waits for the resource lease or acquires a resource-coordinator/room
lock while SQLite is held. The in-transaction lease check is a non-blocking
capability comparison only.

### 6.5 Closed transaction gateway

Merely adding another helper would preserve the producer-enumeration problem.
The implementation therefore needs two transaction capabilities:

- an ordinary transaction, which cannot write the protected footprint; and
- an authorization-publication transaction, created only by the choreography
  above.

All Snapback writable connections must come from one connection gateway. A
connection-level SQLite authorizer or an equivalently low-level mechanism must
then reject writes to the protected footprint unless the second capability is
active. The callback must be connection-local and non-blocking; it must not
read SQLite or acquire process locks. Cargo features may add fixture APIs, but
must never disable this guard, widen the ordinary transaction, or open a path
directly for writing.

This is a Rust/API and deployment boundary, not proof against hostile raw file
access. An independent SQLite connection can omit or replace its authorizer,
disable triggers, and ignore the advisory lease. Therefore:

- `Connection::open*` is inventoried like a producer; no supported public,
  `#[doc(hidden)]`, maintenance, or `test-support` writer may use it directly;
- `rescue_auth_collision_file` is replaced by the typed offline-maintenance
  connection gateway, not retrofitted with an optional callback;
- `install_auth_collision_fixtures_for_test` is demoted to `cfg(test)` or an
  isolated non-servable fixture process whose output cannot be opened by the
  serving format; and
- filesystem ownership/permissions and fleet rollout prevent arbitrary or old
  binaries from retaining raw write access to a production database.

The RFC makes no claim that an in-database mechanism refuses a hostile party
who already owns arbitrary raw write access. Supporting such a party would
require a storage/service boundary outside the database file, not another
SQLite hook.

The protected footprint is derived from the four LLP 0053 events, not simply
"all `_auth_*` tables". At minimum it includes authorization version and
incarnation records; permission-backing facts; active schema, function,
auth-catalog and scope-basis records; reset/import/restore replacements; and
out-of-band revocation facts. Because SQLite authorizers see table/operation
shape more readily than semantic values, the implementation spec must publish
a table/meta-key/DDL coverage manifest and resolve over-broad cases explicitly.
An unclassified protected write fails closed and becomes an inventory failure.

For connections acquired through the mandatory gateway, this mechanism turns
a missed public producer into a refusal. It does **not** automatically cover a
missed path opener, nor provide a producer's correct impact and room
reservation. Connection-open inventory closes the first class; each legitimate
producer still needs an explicit migration row before functionality is
restored.

### 6.6 Existing-database migration

Migration occurs under the exclusive resource lease, before serving:

| Database state | Migration |
|---|---|
| Provably empty, no authorization version/catalog/application state | Install initial authorization state and `Operational` guard in one transaction. |
| Valid legacy authorization version and internally consistent active catalog/schema | Validate the complete protected footprint and install `Operational` with a fresh guard incarnation in one transaction. |
| Existing partial migration or declared offline operation | Enter/resume typed `Maintenance`; do not serve. |
| Missing marker with non-empty contradictory state, corrupt version, or unverifiable catalog | Open read-only quarantine; require operator repair. Never infer `Disabled`. |

The migration is a format migration, not an authorization-epoch publication.
It must be idempotent and leave a durable diagnostic receipt. An older binary
that does not understand the guard cannot be made safe by a marker it does not
read. Migration therefore requires an exclusive lease, shutdown of older
writers, a format/version refusal for cooperative older readers where possible,
and removal of their filesystem write authority before the database is served
again. Otherwise the older binary remains a raw bypass.

### 6.7 Permanent-denial recovery

The recommendation inherits the inverted harm: an incorrect durable guard,
false maintenance declaration, or false lease ownership can make a database
**permanently deny authorization publication and therefore be operationally
unopenable**. This failure mode is explicit and release-blocking.

Recovery is an owner-authorized offline tool, conceptually
`snapback auth-interlock doctor` followed by `recover`:

1. open the database read-only and report a stable coded diagnosis;
2. prove exclusive OS lease ownership and absence of a listener/room
   participant;
3. validate SQLite integrity, protected-footprint consistency, the current
   authorization version, active catalog/schema digests, and any maintenance
   predecessor/operation receipt;
4. require an exact expected digest or signed/exported recovery declaration;
5. repair or complete the operation in one transaction, install
   `Operational` with a fresh random guard incarnation, and append an audit
   receipt; and
6. force every process and client to reacquire/resnapshot before serving.

The tool must not offer "ignore guard", raw marker deletion, or lowering to
`Disabled`. A merely stale sidecar may be cleared only after the OS lock proves
no owner. A contradictory durable record stays quarantined until its exact
predecessor is supplied or the database is restored from backup.

## 7. The seven unguarded public-writer categories

"Automatic closure" below means the closed gateway makes the current bypass
fail before it writes. "Own row" means the producer still needs a deliberate
impact/reservation migration (or demotion) before its intended behavior works.

| Producer | Surface and evidence | Ticket classification | Recommended-design disposition |
|---|---|---|---|
| Function-generation commit | `storage/generation_commit.rs:175-246`; `commit_function_generation` opens `IMMEDIATE`, publishes projection/function-generation state, and commits directly. Default-feature activation and checked-in kernel tests call the producer. | **Correct.** Function activation is LLP 0053 event 2 even when a particular generation appears authorization-neutral. | **Automatically refused, then own row.** Route through the publication transaction with a declared event-2 impact. |
| Auth scope-basis reconciliation | `storage/auth_scope_bases.rs:54-115`; public `LocalDatabase`/serving wrappers commit through `with_auth_transaction`. The inner `_on` comment delegates the hook to a caller, but the public committing wrapper has no such caller-owned hook. | **Correct.** Count the committing wrappers as producers; do not treat their callers as the enumeration. | **Automatically refused, then own row.** Reconciliation needs a defined scope-basis impact and participant reservation. |
| Auth-collision rescue | `storage/auth_rescue.rs:190-221`; local, file, and serving entry points rewrite active authorization metadata and commit without the interlock. | **Mostly correct, but the surfaces differ.** The serving/local routes are live bypasses. The file route is not safe merely because it looks offline: it lacks proof of exclusive resource ownership and no listener. | **Serving/local automatically refuse after the gateway lands; the current path opener does not. Own live row or offline-only row.** Replace the file opener with a typed `OfflineMaintenanceDatabase` rescue under exclusive lease and maintenance receipt; a served rescue needs the normal publication path. |
| Guest reap and guest claim | `identity_reap_guests_default_tombstone` in `storage/auth_identity.rs:3114-3240` advances the epoch directly. Served guest claim reaches `planned_password_change_transaction` in `storage/auth_catalog_ops.rs:1252-1367`, whose `GuestClaim` arm advances it directly; checked-in server/provider tests compose the route. | **Correct.** The producers are the committing reap loop and planned guest-claim transaction, not the low-level `advance_authorization_epoch_in` caller list. The legacy `identity_guest_claim_*` helpers are additive but crate-private and do not themselves advance the epoch. | **Automatically refused, but two own rows.** Reap and claim have different impact, retry, and reservation shapes and should not be one migration row. |
| Graph-corpus stream installation | `storage/auth_stream.rs:27`; `install_graph_corpus_streams_for_test` is `cfg(any(test, feature = "test-support"))`, public, accepts a caller-supplied authorization version, and commits it. Engine test-support calls it directly. | **Correct and real additive surface.** It is not dismissed as a unit seam. | **Automatically refused, then demote or own fixture row.** Preferred: an isolated, permanently non-servable fixture database. If retained dependent-public, it must use a fixture maintenance capability and reject caller-selected terminal epochs. |
| Push-registry/schema fixtures | `storage/push_registry.rs:22` and `:1280`; public additive helpers create registry/application state and replace the handle's active schema; engine/server tests compose them. | **Direction correct; wording needs precision.** The schema replacement is handle-local/in-memory, not itself a durable active-schema publication. The durable registry/application-table writes are still real producer surface and the handle-local replacement is another acquisition/cache hazard. | **Automatically refused where the protected durable footprint is touched; own fixture row or demotion.** A resource-safe design must also stop treating handle-local schema replacement as a database fact. |
| Frozen auth catalogs and collision-manifest fixture | `storage/auth.rs:2662,2717` expose frozen v1/v3 installers under additive `test-support`; `storage/auth_rescue.rs:1073` exposes a test-support file writer for collision/catalog fixtures. Checked-in tests use them. | **Overgrouped.** Frozen v1 and v3 are real dependent-reachable surfaces, but frozen v2 at `storage/auth.rs:2689` is `cfg(test)` only and is not additive public surface. The collision-manifest file writer is a distinct path-opening producer family and should not be hidden in the catalog-installer row. | **Catalog installers automatically refuse on a gateway connection; the collision path opener bypasses that authorizer today. At least two rows or demotions:** guarded catalog fixture installation and collision-manifest file installation. Prefer demoting the latter to unit-only/non-servable fixture construction. The v2 unit-only seam needs no dependent-surface row unless its cfg widens. |

Thus the issue's seven headings are a useful programme grouping, but not seven
implementation rows. Guest reap/claim split, and catalog/collision fixture
installation split; frozen v2 drops from the additive count. The design closes
all current supported-handle bypasses as refusals only if the connection and
protected-footprint gateways are present under every feature union and all
path-opening writers are eliminated or isolated. It does not claim to stop an
arbitrary external raw SQLite writer. Restoring legitimate behavior requires
the per-producer rows named above.

## 8. Absorbing authorization-epoch ceiling

`MAX_AUTHORIZATION_EPOCH` is enforced by
`advance_authorization_epoch_in` (`storage/auth_stream.rs:383`): once the
durable epoch equals the maximum, migration, rollback, and ordinary
authorization publication cannot advance. The additive graph-corpus installer
accepts a caller-supplied version including that exact maximum. This is not
unit-only surface. It can poison a fixture database's incarnation permanently;
the current supported escape is destructive incarnation/database rotation.

The recommended publication guard does **not** use the authorization epoch as
its own generation, so its resource binding does not acquire an additional
absorbing ceiling. It nevertheless inherits the existing availability defect:
the guard correctly refuses every publication whose successor epoch cannot be
represented. With the new fail-closed gateway, the harm becomes the explicit
permanent-denial/unopenable-database failure from §6.7.

The system needs a supported **authorization-stream rollover**, not a larger
integer and not a hidden lowering operation:

1. reserve a high-water band below `MAX_AUTHORIZATION_EPOCH` for rollover;
2. before entering that band, stage a global authorization impact and acquire
   the resource's exclusive publication/room barrier outside SQLite;
3. in one guarded transaction, derive a fresh random authorization
   incarnation, set its epoch to the defined initial value, preserve the
   application/auth catalog, retire the predecessor stream, and write an
   auditable rollover receipt;
4. invalidate all issuer scopes and prepared carriers and force client
   resnapshot under the new incarnation; and
5. settle the barrier only after commit.

If a database is already at the maximum, the offline recovery tool must perform
the same semantic rollover under exclusive lease and exact predecessor
validation. That operation is disruptive but need not destroy application or
identity data. It must never reuse the exhausted incarnation.

The additive graph-corpus helper must either be demoted to unit-only ephemeral
storage or reject caller-selected epochs in the reserved band and construct a
fresh fixture incarnation itself. Tests for exhaustion should use a unit-only
raw seam or a deliberately non-servable fixture format, not a
dependent-reachable writer that can poison an otherwise ordinary database.

## 9. Proof and rollout plan

This RFC is design only. Implementation should not begin until the protected
footprint and lease primitive have their own accepted specification.

### Stage A — freeze the producer and footprint inventories

- Generate the default and additive-union producer inventories.
- Separate `cfg(test)` from dependent-reachable `test-support`.
- Map each producer to one of LLP 0053's four events and to exact
  table/meta-key/DDL operations.
- Enumerate every `Connection::open*` path, including feature-gated fixtures,
  and classify it as read-only, mandatory-gateway, or forbidden/demoted.
- Add every checked-in cross-crate fixture that proves live composition.
- Re-audit F182 as an independent stale-resource-policy row.

### Stage B — specify resource identity, lease, and recovery

- Choose and qualify the lease primitive on supported filesystems.
- Define the in-process exact-resource identity and coordinator lifetime.
- Assign the resource coordinator an explicit lock rank and prove all rank
  edges against LLP 0059's existing order.
- Specify guard record encoding, legacy migration, diagnostics, and operator
  recovery receipts.
- Prove that no wait or coordination-lock acquisition occurs inside the LLP
  0059 prohibited region.

### Stage C — build the closed transaction gateway

- Make ordinary/public transaction capabilities unable to touch the protected
  footprint.
- Make all supported writable connection acquisition pass through the guarded
  factory; remove or demote path-opening public/fixture writers.
- Keep that restriction enabled under additive features.
- Convert each legitimate producer via its own row or demote it to a narrower
  fixture/offline capability.

### Stage D — acceptance schedules

Acceptance includes at least:

- handle A enrolled, handle B separately opened, B attempts every protected
  producer and cannot commit without A's resource coordinator/reservation;
- two independent processes race to publish and exactly one owns the lease;
- crash of the owner releases the lease but does not bypass the durable guard;
- guard changes to `Maintenance` after handle acquisition and the next use of
  that handle refuses because it re-reads in-transaction;
- false/corrupt guard opens read-only, emits a stable diagnostic, and can be
  repaired only through the exact offline-exclusive recovery proof;
- every default and additive producer either commits through the gateway or is
  compile-/runtime-inaccessible to a servable database;
- every `Connection::open*` writer is absent, typed offline-exclusive, or
  permanently limited to a non-servable fixture;
- unit-only raw poison fixtures remain unit-only;
- epoch high-water rollover, already-at-maximum recovery, issuer invalidation,
  and forced resnapshot; and
- the LLP 0059 lock-order checker/race fixtures around reservation, SQLite
  begin/commit, settlement, and lease acquisition.

## 10. Rejected shortcuts and open questions

The following do not satisfy this RFC:

- reading a durable marker only at database open;
- retaining `Disabled` and merely renaming it `Bootstrap` without an empty or
  offline-exclusive resource proof;
- moving a reservation by value and calling the underlying fact single-use;
- trusting an advisory-lock sidecar without an actively held OS lock;
- disabling the guard under `test-support`;
- guarding only explicit calls to `advance_authorization_epoch_in`; or
- deleting a poisoned marker or lowering an exhausted epoch.

Open questions for the follow-on specification:

1. What exact protected table/meta-key/DDL footprint implements LLP 0053's
   semantic event universe without quiescing ordinary authentication writes?
2. Which supported platforms provide a crash-releasing lease with semantics
   strong enough for this resource identity, and which filesystems must become
   read-only/unsupported?
3. Can collision rescue always be offline-exclusive, or is a served rescue a
   required product capability?
4. What high-water band leaves enough epochs to complete rollover and recover
   from one interrupted attempt?
5. Should the checked-in additive fixture databases carry a durable
   `NonServableFixture` format bit, or should all raw fixture installers be
   reduced to `cfg(test)`?
6. What deployment boundary guarantees that old binaries and arbitrary tools
   cannot retain raw filesystem write access after guard migration?

## Revision history

- **Draft r1 (2026-08-25):** measured the handle-state census, default plus
  additive producer surface, and per-row blast radius; compared durable guard,
  type-only, and resource-lease designs; proposed the combined design and
  explicit permanent-denial/epoch-rollover recovery.
- **Draft r2 (2026-08-25):** after independent Codex review, made writable
  connection acquisition part of the safety boundary, scoped SQLite-authorizer
  guarantees to Snapback-owned connections, required path-opening writers to
  be wrapped/demoted, added the hostile raw-file-access limit and fleet
  migration cut, required an explicit resource-coordinator lock rank, and
  corrected the expectation-view method name.
