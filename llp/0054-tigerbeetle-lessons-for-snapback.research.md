# LLP 0054: TigerBeetle lessons for Snapback

**Type:** Research
**Status:** Draft
**Systems:** Storage, Sync, Realtime, Runtime, Testing, Performance, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-13
**Revised:** 2026-07-13 (initial primary-source research draft)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0007, LLP 0008, LLP 0010, LLP 0035, LLP 0038, LLP 0043, LLP 0046, LLP 0047, https://github.com/tigerbeetle/tigerbeetle

## Summary

TigerBeetle is not a storage engine Snapback should adopt wholesale. It is a
specialized financial ledger that owns its replication, storage layout, memory
management, and narrow transaction interface. Snapback is a general application
backend deliberately built on SQLite, Postgres, and Durable Objects, with user
code running through Ibex or V8. The strongest transferable lessons are therefore
**engineering disciplines**, not TigerBeetle's physical architecture:

1. make whole-system deterministic simulation a primary correctness tool;
2. test safety under faults and liveness after selected faults become permanent;
3. put an explicit upper bound on every retained resource and concurrency lane;
4. pair assertions across producer/consumer and write/read boundaries;
5. fault the real storage and process boundaries, not only pure state machines;
6. design interfaces that permit automatic batching without weakening latency or
   correctness contracts.

Snapback already shares important parts of this posture: one commit/version
authority per app stream, atomic changesets, bounded queries and mutation plans,
hard retained-ledger and realtime limits, deterministic reset/replay inputs, a
specified message-level sync harness, and benchmark-driven optimization. The
largest gap is that these pieces are tested mostly through example-based suites.
Snapback does not yet have one seeded, generative, whole-system harness that drives
the real state machine through message faults, storage failures, process restarts,
auth invalidation, journal pruning, and replay while continuously checking safety
and eventual progress.

The recommended first investment is a **small Snapback deterministic simulator**,
not a TigerBeetle-sized reimplementation. Its first slice should combine a
reference model, injected clock/id/transport/storage seams, reproducible seeds,
and kill-and-reopen testing around the SQLite commit boundary. This would turn
several already-written Snapback contracts into continuously checked properties.

## Method and provenance

This is the focused primary-source follow-up to
[LLP 0001](./0001-prior-art.research.md), following the same pattern by which that
broad survey delegated the ElectricSQL/PowerSync/Turso pass to
[LLP 0022](./0022-electric-powersync-turso.research.md). TigerBeetle was compared
against Snapback's current LLP corpus and source tree on 2026-07-13.

TigerBeetle facts were checked against current first-party material:

- [TigerBeetle Architecture](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/ARCHITECTURE.md)
  for the replicated-state-machine model, static limits, determinism, simulation,
  checksums, single-threaded execution, and control/data-plane separation;
- [TigerStyle](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md)
  for bounded control flow, assertion pairing, positive/negative-space testing,
  explicit errors, dependency posture, and batching;
- [Simulation Testing for Liveness](https://tigerbeetle.com/blog/2023-07-06-simulation-testing-for-liveness/)
  for the safety/liveness split and permanent asymmetric-fault method;
- [A Descent Into the Vörtex](https://tigerbeetle.com/blog/2025-02-13-a-descent-into-the-vortex/)
  for the complementary outside-in generative harness over stock binaries;
- [Performance](https://docs.tigerbeetle.com/concepts/performance/) and
  [Requests](https://docs.tigerbeetle.com/coding/requests/) for the specialized
  interface, pervasive batching, and automatic client batching;
- [Swarm Testing Data Structures](https://tigerbeetle.com/blog/2025-04-23-swarm-testing-data-structures/)
  for model-based property tests whose operation distributions are themselves
  randomized.

Tags distinguish fact from recommendation:

- **[confirmed]** — verified in the cited TigerBeetle source or Snapback tree;
- **[observed]** — seen in the current Snapback implementation or corpus but not
  established as a complete whole-system fact;
- **[inferred]** — this document's recommendation or interpretation, not a
  ratified Snapback decision.

## Findings

### 1. Deterministic simulation is the highest-leverage transferable idea

TigerBeetle's VOPR runs the real replicated-state-machine implementation behind
simulated time, network, storage, and process interfaces. A failure is identified
by its seed and can be replayed exactly. The simulator checks implementation code,
not merely a model of the intended algorithm. [confirmed]

Snapback already specifies a deterministic message-level sync harness with
explicit `flush`, `deliver`, and `sync` controls plus disconnect, drop, and reorder
faults ([LLP 0010](./0010-agent-dx-and-acceptance.spec.md#test-surfaces-and-harness)).
Runtime-provided time and generated ids are recorded for replay, portable query
ordering is deterministic, and tests use deterministic reset/seed paths.
[confirmed]

What is missing is composition. The harness described in LLP 0010 does not yet
continuously combine the real commit state machine with auth epochs, retention
floors, exactly-once settlements, client overlays, process restart, and storage
failure. The system review separately calls for kill-and-reopen crash recovery
([LLP 0038](./0038-snapback-system-review.research.md#part-7--recommendations)),
and the storage layer currently exposes a narrow test-only failure hook immediately
before reset-and-seed commit rather than a general commit fault surface.
[confirmed]

**Influence:** build a seeded generative harness around Snapback's existing seams,
using the real implementation wherever practical and a deliberately simple
reference model for observable behavior. [inferred]

### 2. Safety-mode testing alone can conceal liveness failures

TigerBeetle found that continuously random faults can hide a stuck system because
the next random restart or partition heal eventually rescues it. VOPR therefore
separates a safety phase, where arbitrary faults explore state, from a liveness
phase, where a healthy core is selected, its internal faults are healed, outside
faults become permanent, and the core must finish work. This exposed asymmetric
partition and repair-routing failures that safety-only fuzzing missed. [confirmed]

Snapback is not yet a replicated database cluster, but it has analogous liveness
risks: a stale connection preventing supersession, an outbox that never drains, a
replay queue blocked by one ambiguous receipt, a resync loop, a cron/action lane
that never recovers, or an old authorization epoch keeping a subscription in
permanent limbo. [inferred]

**Influence:** every generative scenario should have two phases:

1. **fault/explore** — inject disconnects, message drop/duplication/reordering,
   response loss, restart, pruning, auth changes, and bounded storage failures
   while asserting safety;
2. **heal/prove progress** — stop recoverable faults, preserve selected stale or
   dead participants, advance virtual time, and require authorized clients to
   converge, queues to drain or fail terminally, and new mutations to complete.

The liveness oracle must use bounded logical steps, never sleeps. [inferred]

### 3. Explicit limits are a system model, not scattered defensive constants

TigerBeetle computes an upper bound for each runtime object class at startup and
allocates accordingly. Its key architectural claim is broader than static memory:
if every component has a limit and neighboring components honor one another's
limits, overload behavior becomes designed rather than emergent. [confirmed]

Snapback already has many correct local bounds: materialized query size, filter
bindings, buffered mutation writes, live subscriptions, retained replay results,
per-auth and global ledger bytes, outbound queue lanes, handler/action limits, and
journal retention. Several limits are surfaced in diagnostics or inspection.
[confirmed]

The remaining risk is **aggregate composition**. Individually bounded lanes can
still exceed an app's memory, file, CPU, or open-task budget when multiplied by
connections, subscriptions, auth identities, and concurrent actions. Some caps
also live as implementation constants rather than one reviewable resource model.
[observed]

**Influence:** create a generated **resource-limit ledger** that records, for each
resource, its scope, unit, default, hard/soft behavior, refusal or degradation
mode, inspection gauge, and tests. Add composition assertions such as “the sum of
all outbound lanes is bounded by the connection budget,” not only per-lane caps.
Expose target-specific values through the existing capability and gated inspection
surfaces. Do not require static allocation; the transferable idea is complete,
coherent bounds. [inferred]

### 4. Assertions should form contracts across boundaries

TigerStyle distinguishes expected operating errors, which must be handled, from
impossible internal states, which should fail loudly. It recommends checking
function inputs, outputs, invariants, positive and negative space, and pairing the
same property on distinct paths—for example, immediately before persistence and
again after reading. TigerBeetle combines production assertions with simulation,
fuzzing, unit tests, integration tests, and an outside-in binary harness.
[confirmed]

Snapback has strong schema admission checks, SQL constraints, debug convergence
assertions, structured diagnostics, and many targeted regression assertions.
[confirmed] The TigerBeetle lesson is not to chase an assertion-density metric; it
is to identify the few cross-layer relationships whose violation would silently
invalidate sync or durability. [inferred]

Candidate paired invariants:

- before commit and after journal read: every row change in one mutation carries
  the single allocated commit version;
- when advancing and when consuming the retention floor: replay at or above the
  floor is contiguous, while replay below it forces resnapshot;
- before storing and after reopening an exactly-once settlement: its function,
  input, auth, output, and settled version remain mutually consistent;
- before realtime publication and after client application: one multi-row
  changeset is observed atomically;
- when recording and consuming an authorization epoch: stale authority cannot
  produce retained or live visible state;
- when updating and inspecting byte/count ledgers: stored counters equal
  recomputed contents within their declared limits.

Expected corruption or I/O failure should produce a stable diagnostic and refuse
unsafe progress. Assertions are appropriate only after the boundary has validated
external data and the remaining state is genuinely impossible. [inferred]

### 5. Crash and storage-fault testing should exercise the real binary

TigerBeetle complements deterministic simulation with Vörtex, which supervises
stock binaries and language clients, injects network and process faults externally,
and checks safety and liveness. The purpose is to cover wrappers, operating-system
I/O, and other surfaces stubbed by the simulator. [confirmed]

For Snapback, SQLite already owns WAL, atomic commit, and page-level recovery. The
high-value test is therefore not to simulate SQLite internally, but to prove that
Snapback's facts on either side of SQLite's commit boundary remain coherent.
[inferred]

The first fault matrix should kill or inject failure:

- before and after read-set validation;
- before version allocation;
- after application-row writes but before change-journal writes;
- after journal and settlement writes but before `COMMIT`;
- immediately after `COMMIT` but before receipt or realtime publication;
- during reset, schema apply, retention-floor advancement, and journal pruning;
- on reopen with disk-full, permission, I/O, malformed-metadata, and SQLite
  corruption diagnostics where the platform can inject them safely.

After reopen, each operation must be wholly old or wholly new—never half applied.
Committed-but-unpublished changes must be discoverable through replay/resnapshot;
an ambiguous client response must not allow duplicate execution; corruption must
fail closed with a stable diagnostic. The harness should preserve the failing seed,
fault point, operation trace, and database artifact when safe. [inferred]

### 6. Batching is most powerful when enabled by the interface

TigerBeetle's narrow debit/credit interface accepts batches, and its clients
automatically combine concurrent operations so consensus and I/O overhead are paid
once per batch. This is inseparable from its specialized workload. [confirmed]

Snapback should not replace application handlers with a fixed transfer API. It
already has the more relevant primitive: a bounded, analyzable mutation/query IR,
atomic multi-write changesets, changes grouped by client, and explicit target
adapters. [confirmed]

**Influence:** preserve batching opportunities at target boundaries—queued replay
upload, journal reads, WebSocket delivery, Postgres commit work, and Cloudflare
storage calls—and add adaptive microbatching only when measurements show the fixed
cost dominates. Batch formation must have explicit count/byte/time bounds, preserve
per-app commit order and changeset atomicity, and shrink under light load. Do not
add latency or semantic complexity speculatively. [inferred]

## Recommended Snapback simulator

### State and seams

Start with one app stream, one server, two clients, and the real in-memory or
temporary-file SQLite adapter. All nondeterministic inputs that affect observable
behavior pass through injected interfaces:

- virtual monotonic and wall clocks;
- deterministic runtime ids and replay environments;
- a transport scheduler that can deliver, delay, drop, duplicate, reorder, and
  disconnect;
- process lifecycle control, including reopen from the same database;
- named storage/commit failpoints;
- a seeded operation generator and compact trace recorder.

The reference model should describe only the portable observable contract:
authoritative rows, commit stream/version, retained journal interval, settled
client mutations, authorization generation/epoch, queued optimistic mutations,
subscriptions, and visible client rows. It must not reproduce implementation
internals, or it will reproduce the same bugs. [inferred]

### Generated operations

- invoke a query or mutation, including multi-row and conflicting mutations;
- enqueue offline work and acknowledge a settled mutation;
- subscribe, supersede, disconnect, reconnect, and resubscribe;
- deliver, drop, duplicate, reorder, or lose a response/message;
- advance time, tick cron/outbox work, and expire ephemeral state;
- change authorization facts and advance an auth epoch;
- prune the change journal or cross the retention floor;
- reset or change the artifact/schema generation;
- inject one storage failure or crash/reopen at a named boundary.

Use swarm-style generation: randomize not only operations but their distribution
per run, so some seeds emphasize long offline queues, conflicts, auth churn,
pruning, backpressure, or restart. Include fixed regression seeds alongside fresh
CI seeds. [inferred]

### Safety properties

At every logical step:

1. commit versions are monotonic and gap-free in visibility order;
2. every committed changeset is atomic and every surviving row's `_version`
   identifies the mutation that last changed it;
3. acknowledged or retained client mutation identities never execute twice;
4. a client never exposes data under known-stale authority;
5. replay either supplies a contiguous suffix or requires resnapshot;
6. optimistic multi-row changes appear and roll back atomically;
7. server and eligible clients converge after all messages through a cursor are
   delivered;
8. every retained resource remains within both its local and aggregate budget;
9. failure before commit leaves the prior state; failure after commit leaves a
   complete recoverable state;
10. capability and diagnostic reports describe the behavior exercised.

### Liveness properties

After recoverable faults stop and virtual time advances for bounded logical steps:

- a connected authorized client obtains a fresh snapshot or completes replay;
- pending mutations settle, conflict, deny, or fail terminally rather than remain
  forever ambiguous;
- outbound queues drain or collapse to the documented resync signal;
- a stale or permanently disconnected participant cannot prevent healthy clients
  from making progress;
- cron/outbox work either executes or records a bounded, inspectable failure;
- new mutations can still commit after recovery.

## Ranked adoption plan

1. **Crash/reopen property harness.** Add named commit failpoints and a subprocess
   driver around the local SQLite target. Prove the old-or-new state rule and the
   consistency of rows, versions, journal records, and exactly-once settlements.
2. **Seeded sync/replay model.** Compose existing message controls with a small
   reference model for two clients, response loss, offline replay, retention
   floors, and resnapshot.
3. **Authorization and liveness phase.** Add epoch invalidation, user switch,
   permanent stale participants, healed healthy participants, and bounded progress
   assertions.
4. **Resource-limit ledger.** Inventory existing caps, generate capability and
   inspection facts, and add aggregate limit assertions to the simulator.
5. **Outside-in soak lane.** Run stock server/client artifacts under kill, pause,
   reconnect, and constrained-resource faults to cover seams the deterministic
   harness replaces with interfaces.
6. **Measured batching.** Use LLP 0035-style evidence to select the next fixed-cost
   boundary; batching is not a prerequisite for the correctness harness.

This ordering is an inference, not an implementation plan or acceptance decision.
Any landing work should be owned by a Plan or RFC that names its exact scope and
tests. [inferred]

## Ideas not to transfer wholesale

### Static allocation and zero dependencies

TigerBeetle can impose these constraints because it owns a narrow engine from the
kernel interface upward. Snapback deliberately composes SQLite, Postgres, Durable
Objects, Ibex/V8, Rust crates, and JavaScript packages.

**Keep:** explicit complete bounds, dependency scrutiny, strict build inputs, and
designed overload behavior. **Reject:** post-startup zero-allocation and a blanket
zero-dependency policy as Snapback requirements. [inferred]

### One thread everywhere

TigerBeetle sequentializes a deliberately contentious financial state machine on
one core while overlapping I/O. Snapback already makes the analogous useful choice
at the correct boundary: one commit/version authority per app stream, with handler
execution, queries, network I/O, and target operations allowed concurrently.

**Keep:** serialized commit visibility until measurements justify a more complex
contract. **Reject:** globally single-threaded handler/runtime/network execution.
[inferred]

### A custom replicated checksummed storage engine

TigerBeetle's external checksums, hash-chained log, physical determinism, and block
repair are co-designed with its six-replica storage engine. Snapback delegates
physical durability to SQLite, Postgres, and Durable Objects.

**Keep:** checksummed logical export artifacts and sync payloads where they make
migration or corruption detection materially safer; paired logical invariants
around the change journal. **Reject:** rebuilding replication, page layout, WAL,
or physical repair inside Snapback. [inferred]

### A ledger-shaped application API

TigerBeetle's performance follows partly from a fixed debit/credit domain model.
Snapback's purpose is general application backends.

**Keep:** bounded analyzable IR and automatic batching beneath the public handler
model. **Reject:** constraining all applications to a small built-in transaction
vocabulary. A finance-specific Snapback package might use TigerBeetle as a
separate specialized service later, but it should not become the default data
tier. [inferred]

## Open questions

- Should the first deterministic harness operate directly on `LocalSnapback`, or
  through the public wire protocol so it covers serialization and routing early?
- Which nondeterministic seams still bypass runtime-provided clock/id/replay inputs,
  especially inside Ibex/V8, cron, actions, and client adapters?
- Can SQLite I/O failures be injected portably through a VFS/test adapter, or
  should the first slice use named Snapback failpoints plus external faults?
- Which invariants are safe as production assertions, which belong in a gated
  deep-doctor operation, and which are too expensive outside tests?
- Should the resource-limit ledger become generated schema/capability data, or a
  Rust authority projected into the existing manifest machinery?
- What is the smallest reference model independent enough to catch bugs without
  duplicating Snapback's implementation?
- Which seeds and traces are safe and compact enough to retain as CI artifacts and
  permanent regressions?

## Confidence

- **TigerBeetle characterization: high.** Claims come from current first-party
  architecture, style, product documentation, and engineering posts.
- **Snapback current-state characterization: high.** The relevant contracts and
  limits were read in LLP 0003, 0007, 0008, 0010, 0035, 0038, 0043, 0046, and
  0047 and spot-checked against `crates/snapback/src/storage.rs` and the current test tree.
- **Priority ordering: medium-high.** Crash/reopen and composed sync/replay testing
  close already-recorded proof gaps. The simulator boundary and storage injection
  mechanism need a scoped design pass.
- **Batching benefit: medium.** TigerBeetle proves the general technique, while
  Snapback must choose concrete batching work from its own benchmarks.
- **Logical checksums beyond export/import: low-medium.** They may help diagnose
  corrupt artifacts or transport, but the benefit is unmeasured and physical
  durability belongs to target stores.

## Status

Draft research only. This document records transferable lessons and a proposed
sequence; it does not ratify a simulator architecture, change Snapback's storage
contract, or authorize implementation. The natural hand-off, if Charlie chooses
to act on it, is a focused Plan for the crash/reopen and seeded simulator slice.
