# LLP 0138: Zero and Replicache local-sync bakeoff

**Type:** Plan
**Status:** Implemented
**Systems:** Competitive evaluation, Demo applications, Developer experience, React, Data modeling, Relational queries, Realtime, Offline sync, Optimistic updates, Auth, Conflict handling, Performance, Testing, Documentation
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-31
**Revised:** 2026-08-01 (corrected the retained Fleet failure diagnosis after exact-fixture inspection proved all writes durable: an implicit 1,024-row query prefix was silently treated as complete before application-side ordering) 2026-08-01 (implemented all six paired applications and the Replicache control; retained 13 provider receipts, six diaries, one Snapback Fleet visibility failure, explicit browser-carrier gaps, and the final improvement synthesis)
**Related:** LLP 0000, LLP 0008, LLP 0010, LLP 0015, LLP 0016, LLP 0035, LLP 0043, LLP 0053, LLP 0059, LLP 0061, LLP 0074, LLP 0080, LLP 0090, LLP 0102, LLP 0107, LLP 0114, LLP 0126, LLP 0127, LLP 0129, LLP 0130, LLP 0137

## Summary

Run a focused local-sync bakeoff between Snapback and Zero across six React
application shapes. The program exists to learn what Snapback should improve in
the territory where Zero is strongest: query-driven partial sync over relational
data, optimistic shared mutators, reactive queries, and fast interaction over a
server-authoritative database.

Zero is the primary current Rocicorp product. Replicache is its archived
predecessor and is not folded into the Zero score. One separate Replicache arm
is retained for the Field Notebook application because durable offline mutation
and rebase remain a material Replicache capability that current Zero
deliberately does not provide.

The six applications are:

1. Triage Graph — a relational issue inbox;
2. Latency Kanban — an optimistic planning board under injected latency;
3. Contention Calendar — resource booking with invariant conflicts;
4. Private Incident Room — multiplayer collaboration with revocation;
5. Field Notebook — retained reads, network loss, and offline intent; and
6. Fleet Observatory — large query-driven partial sync and filter churn.

Every application receives provider-native Snapback and Zero implementations,
one immutable diary, machine-readable acceptance evidence, and an explicit list
of gaps and nonclaims. The final synthesis judges authoring, observable product
behavior, correctness, and measured performance separately before making a
qualitative go-to recommendation and proposing Snapback-native improvements.

## Why this is a separate program

LLP 0102 is a completed and frozen comprehensive-backend bakeoff. Its evidence
must not be rewritten. LLP 0137 explicitly excludes composable sync layers such
as Zero from its comprehensive-backend championship because Zero does not claim
to provide the whole auth/functions/files/jobs/deployment surface.

This Plan studies the narrower and strategically important sync layer. It reuses
LLP 0102's provider-native implementation rule, immutable diaries, exact target
identity, evidence confidence, safe cleanup, and Stop-class discipline without
reusing its holistic backend ranking.

LLP 0129 remains the authority for Snapback's local-first program. This bakeoff
measures the product state that program ships and may create findings for its
ledger; it cannot silently weaken its server-authoritative or execution-identity
constraints.

## Provider profiles

### Snapback

- current repository source on the canonical local Ibex/SQLite target;
- first-party generated JavaScript references and React bindings where the
  application uses React;
- default durable client-store behavior, retained/current freshness, ordered
  mutation outbox, explicit conflict diagnostics, and protected-retention
  limits reported exactly as served;
- no hosted claim inferred from local evidence.

### Zero

- Zero 1.8.0, the current GA open-source product at program freeze;
- local PostgreSQL 15 or newer with logical replication;
- `zero-cache-dev`, ZQL, first-party React bindings, shared `defineMutator`
  implementations, and application-owned TypeScript query/mutate endpoints;
- locally signed test bearer identities for `alice`, `bob`, and `mallory`;
- cached offline reads and disconnected-write refusal represented honestly;
- no Cloud Zero or managed-production claim inferred from local evidence.

### Replicache control

- Replicache 15.3.0 for Field Notebook only;
- application-owned push, pull, poke, version/cookie, authorization, and
  idempotence protocol against the same local PostgreSQL fixture class;
- durable IndexedDB pending mutations and rebase measured separately;
- no result included in the Zero score or described as current Zero behavior.

The initial local program needs no Rocicorp API or license key. A managed Cloud
Zero extension is a separately authorized future stage.

## Comparison rules

### Shared facts, provider-native implementations

The arms share product facts, deterministic data, personas, timestamps,
network profiles, and stable UI test identifiers. They do not share a backend
abstraction. Provider-specific schema, queries, permissions, mutators,
transactions, subscriptions, endpoints, and lifecycle code remain visible and
count toward authoring cost.

The neutral React shell may share visual components. It must not normalize
away provider state machines: Zero's `unknown`/`complete`, Snapback's
retained/current and connection axes, and Replicache's pending/rebase state are
rendered with their actual meanings.

### Evidence classes stay separate

For each arm report capability and observable facts, correctness confidence,
authoring cost, source cost, local-paint/acknowledgement/convergence latency,
attributable client/server resources, and setup/cleanup experience. No single
composite may hide an unsupported capability, Stop-class defect, or confidence
difference.

### Optimism is not authority

An immediate render proves only local prediction. Each optimistic scenario must
also prove server acceptance or rejection, rollback/rebase behavior, and final
canonical convergence from an independent observer.

### Authorization is a sync property

An outsider denial must prove protected rows were not delivered to the client,
not merely hidden by React. Revocation must stop future delivery and retire or
quarantine active client state according to the provider contract. Offline byte
custody and hostile-device guarantees remain explicit nonclaims.

### Performance discipline

Cross-provider claims require the same machine, dataset, warmup, network
shaping, and target class. Record raw samples plus median and nearest-rank p95.
A different-machine or hosted sample is not comparative evidence.

## The six application contracts

### A1 — Triage Graph

Organizations, teams, projects, issues, labels, comments, and activity form a
relational issue inbox over a 10,000-issue deterministic seed.

Required facts:

- "my inbox" combines assignment and accessible-team membership;
- issue rows compose project, assignee, labels, and comment count;
- detail adds the latest twenty comments and activity;
- team, status, priority, label, and assignee filters compose;
- stable keyset pagination has no duplicate untouched row;
- matching remote changes appear live and nonmatching changes do not perturb
  the visible result;
- rapid switching among ten saved filters never exposes predecessor rows;
- partial/unknown versus complete/current results are visible; and
- Mallory receives no protected issue rows.

### A2 — Latency Kanban

Four columns and 500 cards are manipulated by three users with 1,000 ms of
injected authoritative mutation latency.

Required facts:

- create, edit, assign, archive, and reorder paint within one animation frame
  where the provider supports optimism;
- twenty rapid moves neither duplicate nor lose a card;
- a locked-card rejection removes or rebases only its speculative change and
  exposes an actionable error;
- reload during pending settlement has documented, loss-free behavior;
- two concurrent moves of one card converge to one deterministic order;
- an independent observer converges to the authoritative board; and
- input-to-paint, acknowledgement, and convergence are measured separately.

### A3 — Contention Calendar

Twenty rooms and equipment resources expose invariant conflicts under
simultaneous reservation.

Required facts:

- two clients contend for the final capacity in one time slot;
- exactly one authoritative transaction commits;
- the losing prediction corrects visibly and offers a valid alternative or
  explicit failure;
- ambiguous retry cannot create a duplicate reservation;
- nonoverlapping reservations both commit;
- all observers converge on schedule and capacity; and
- the diary identifies where prediction and server conflict policy live.

### A4 — Private Incident Room

Commanders, responders, observers, and outsiders collaborate on incidents,
tasks, notes, and a durable message stream.

Required facts:

- responders see only joined incidents, observers are read-only, and outsiders
  see no protected data;
- authorized durable writes appear live across three clients;
- removing a responder stops future delivery and retires or quarantines the
  active protected result;
- a pending write crossing revocation is rejected authoritatively;
- user switch does not expose predecessor data;
- an out-of-band permission change is observed within a measured bound; and
- optional presence is classified separately and never scored as ephemeral
  when implemented as durable rows.

### A5 — Field Notebook

Two hundred structured field records, assignments, and checklists exercise
intermittent connectivity.

Core paired facts:

- after one sync, a cold browser restart with the backend unreachable renders
  retained records where supported;
- retained state is labeled stale/unknown rather than current;
- a short interruption queues or refuses one write according to the provider's
  declared contract, without silent loss;
- once disconnected, unsupported writes are prevented or refused clearly;
- application-owned draft storage preserves user input after a refusal;
- reconnect yields one authoritative record with no duplication; and
- logout/cache deletion behavior is exercised and recorded.

Stretch facts run on Snapback and the separate Replicache control:

- queue a create and update through a fifteen-minute outage;
- restart offline with speculative state still visible;
- reconnect and rebase against a concurrent remote edit; and
- settle exactly once with a visible conflict outcome.

### A6 — Fleet Observatory

Twenty-five thousand devices and 250,000 events exercise large partial sync and
reactive query churn.

Required facts:

- the initial route requests only the latest 100 events for one fleet plus
  related device and owner facts;
- first useful rows and authoritative completeness are timed separately;
- twenty filter switches measure warm-local and hydration latency without
  predecessor leakage;
- 1,000 updates with exactly 100 active-query matches converge without a full
  browser dataset transfer;
- twenty simultaneous active views report attributable resources and latency;
- warm and cold restarts are measured; and
- unauthorized fleet rows are never replicated to Mallory's client.

## Protocol and diaries

Before implementation, freeze one acceptance manifest per application with
expected check counts, deterministic fixtures, provider versions, machine and
network profile, actors, evidence/cleanup schemas, assistance policy, and diary
template. Builds may run in parallel.

Each numbered diary records both primary arms together. It includes chronology,
the immutable first attempt, failed paths, assistance, source/touch counts,
acceptance results, latency/resource evidence, what felt good or bad,
provider-specific surprises, Snapback guide gaps, and an initial verdict. Later
fixes append dated remediation entries rather than rewriting history.

## Execution stages

1. Freeze the contracts, schemas, fixtures, versions, and environment receipt.
2. Build A1 and A2 in parallel and audit the harness for distortion.
3. Build A3–A6 in parallel on disjoint app directories.
4. Run headless correctness, browser, connectivity, concurrency, and measured
   performance checks.
5. Seal the six first-pass diaries and classify every finding.
6. Fix only high-confidence reusable Snapback gaps; otherwise file issues or
   LLP proposals.
7. Rerun affected scenarios without overwriting original evidence.
8. Publish the dimension-separated comparison and improvement synthesis.
9. Run guide checks, reference checks, relevant tests, and an
   LLP-maintain-style audit before landing.

## Stop classes

Pause an affected arm for cross-user data delivery, false capability claims,
duplicate or lost claimed-settled intent, invariant violation, unsafe cleanup,
secret exposure, or a zero-check/short/fabricated pass. Unsupported behavior
recorded as a GAP is not a Stop. Environment unavailability is not a product
failure.

## Snapback synthesis contract

Every improvement records its source evidence, classification, reach, the
competitor outcome worth matching, the Snapback property to preserve, the
smallest coherent Snapback-native outcome, an acceptance witness, and an owner.

The synthesis explicitly answers where Snapback is better, where Zero is
better, where Replicache's offline model remains better, which gaps are
capability versus implementation or DX, which fixes have the highest user
value, and whether evidence fires LLP 0129's trigger to reconsider
Replicache-class app-authored client mutators.

## Status

Implemented on 2026-08-01. The frozen protocol, six applications, thirteen
provider arms, raw receipts, environment qualification, and diaries 0042–0047
live under `demos/zero-bakeoff/` and `diaries/`. The final synthesis is
`demos/zero-bakeoff/reports/summary.md`.

The primary Snapback arms retained 47 PASS, 3 GAP, and 1 FAIL; the primary Zero
arms retained 46 PASS, 5 GAP, and 0 FAIL. The separate Field Notebook
Replicache control retained 8 PASS, 3 GAP, and 0 FAIL. Totals are completeness
facts rather than a composite score. The Snapback failure is the Fleet
Observatory arm returning an incomplete implicit 1,024-row query prefix to
application JavaScript, which then sorted and sliced the prefix as if it were
the complete indexed result. Exact-fixture follow-up proved the reported 1,000
writes committed; the product failure was silent query incompleteness, not
mutation durability or invalidation. The original receipt remains immutable,
and the corrected diagnosis and fail-closed remediation are tracked in
`issues/closed/20260801-fleet-query-implicit-limit.md` and landed as
`b52e3b9c`. The corrected indexed/ordered Fleet handler subsequently retained
7 PASS, 1 browser-carrier GAP, and 0 FAIL in `snapback.v2.json`; the immutable
v1 result remains in the primary totals. Browser IndexedDB
restart remained an explicit carrier evidence GAP where the local headless arm
could not certify it.

No Rocicorp credentials were required. Evidence is local/self-hosted and does
not make Cloud Zero, hosted Snapback, browser-compositor, production-scale, or
cross-machine performance claims.
