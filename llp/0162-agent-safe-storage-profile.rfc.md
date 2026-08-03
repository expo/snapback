# LLP 0162: Agent-safe storage profile

**Type:** RFC
**Status:** Draft
**Systems:** Storage, Runtime, Sync, Auth, Effects, Migrations, Agent experience, Diagnostics, Testing, Performance
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-03
**Revised:** 2026-08-03 (v0.2 — first cross-family review round applied: envelope keyed by operation identity with the commit version demoted to a stream-qualified snapshot association; the promotable fork class pinned to LLP 0097's in-app branch, with LLP 0158 derived-deployment forks capture-only; named checkpoints split into materialized and receipt-only substrate classes; per-fact read-set provenance discriminators per LLP 0007/0133/0146; LLP 0088's history invariants imported normatively; replay-sufficient promotion record required and the landed post-image `branches::promote` path marked superseded; capability claims routed through LLP 0134; commissioning authorities and amendment ownership named)
**Related:** LLP 0000, LLP 0007, LLP 0008, LLP 0012, LLP 0018, LLP 0035, LLP 0037, LLP 0043, LLP 0051, LLP 0053, LLP 0055, LLP 0070, LLP 0072, LLP 0081, LLP 0088, LLP 0090, LLP 0094, LLP 0095, LLP 0097, LLP 0129, LLP 0130, LLP 0133, LLP 0134, LLP 0146, LLP 0155, LLP 0158, LLP 0159, LLP 0160, LLP 0161

> **Proposal boundary.** LLP 0161 derives nine ideal properties for an
> agent-optimized storage engine. This RFC does not claim all nine at their
> strongest form. It proposes a deliberately bounded profile that answers most
> of the agent questions behind P1-P9 without replacing SQLite, adding temporal
> machinery to ordinary reads, or maintaining a Merkle tree on every write.

## Summary

Adopt an **agent-safe storage profile** built from three composable primitives:

1. a **universal commit envelope** for every covered durable state transition;
2. a **safe current-head fork** with effect quarantine, bounded lifetime, exact
   journal diff, and strict promotion by re-execution; and
3. **bounded proof and history** based on complete change journals, named
   checkpoints, and `ContentDigestV1` at proof boundaries rather than on every
   commit.

The local reference implementation keeps stock SQLite as its physical engine.
Ordinary current-state reads remain ordinary application-shaped SQL. Ordinary
writes add constant-sized commit metadata plus records proportional to the
captured read/write/effect facts. Expensive work — database copies, full
digests, historical materialization, and branch effect simulation — happens
only at an explicit agent operation or proof boundary.

The profile intentionally implements P1, P3, P5, P8, and P9 strongly on its
declared paved paths; preserves the already-strong deterministic-handler and
migration-proof halves of P6 and P7; and substitutes journal-based diff plus
named checkpoints and bounded change history for full P2 and P4. It does not
change LLP 0088's rejection of merge as sync-core machinery. A successful fork
is kept by LLP 0097's promotion-by-re-execution path, never by storage merge.
The promotable fork class is LLP 0097's in-app branch; LLP 0158's
schema/function-divergent derived-deployment forks remain capture-only in v1,
preserving LLP 0158's merge-back non-goal unamended.

This is a product and engine-layer proposal, not a physical-storage rewrite and
not a commission to implement. The claim boundary, stated once and referenced
elsewhere: document status and capability status are separate facts (LLP 0134
owns the latter); no target may advertise any profile capability above
`Missing` until the acceptance corpus passes on that target, and while this RFC
is Draft nothing may be advertised at all.

## Motivation

LLP 0161's P1-P9 set comes from three real agent pressures: speculation, proof
over memory, and concurrency without coordination. The strongest realization
of every property is coherent, but several parts have high cost relative to the
first agent outcome they unlock:

- maintained Merkle state puts hash maintenance and durable tree lifecycle on
  every write primarily to make arbitrary state comparison cheap;
- database-wide `AS OF` requires a retained historical representation,
  historical schema semantics, authorization, compaction, and garbage
  collection;
- generic bidirectional lenses must either restrict their transformation
  algebra or retain complement data for otherwise lossy changes; and
- universal replay of nondeterministic actions requires storing or simulating
  external observations that may be large, secret, or impossible to reproduce.

Most day-to-day agent questions are narrower:

- What operation made this commit, under whose authority?
- What did the operation read and write?
- Did my earlier attempt already commit?
- Can I try this against real-shaped data without affecting canonical state or
  firing real effects?
- What changed in the try, and can I safely keep it?
- How did this record change recently?
- Can I prove a migration, checkpoint, or promotion boundary?

Snapback already has separate foundations for these answers: commit versions
and a row journal; server-captured read facts on the Ibex lane (host-plan
deciding reads are client-supplied validated baselines per LLP 0007);
deterministic ctx-answer ledgers; specialized settlement receipts (today keyed
by the optional `clientMutationId`, which first-party clients default off);
migration proofs; scoped grants (LLP 0055) and fencing where lanes define
them; plus LLP 0097's landed-but-unwired branch substrate. The 80/20 move is
to join those foundations into one honest durable-operation contract before
adopting a new physical storage engine or a fully temporal logical layout.

## Goals

- Make every covered durable operation attributable, explainable,
  retry-addressable, authority-scoped, and receipt-producing.
- Make speculative execution against a current real-shaped database safe by
  default and bounded in resources.
- Give forks an exact machine-readable diff for every declared covered lane.
- Preserve deterministic query/mutation re-execution and make its coverage
  legible.
- Give agents recent record-change history and explicit checkpoints without
  imposing temporal predicates on the current-state query path.
- Preserve stock SQLite's planner, indexes, constraints, transactions, crash
  recovery, backup primitives, and direct inspectability on the canonical local
  target.
- Define portable semantics whose target mechanics can differ across SQLite,
  Postgres, and Cloudflare while advertising their actual capability class.
- Establish evidence-based triggers for revisiting incremental Merkle state,
  arbitrary database-wide as-of, general lenses, or a version-native physical
  engine.

## Non-goals and explicit non-claims

The v1 profile does **not** claim:

- incrementally maintained Merkle roots for every table or O(1) comparison of
  arbitrary states;
- arbitrary database-wide `AS OF` at every retained commit;
- indefinite history retention;
- general or persistent data branching;
- merge of divergent branch state into the sync core;
- promotion onto an advanced canonical head;
- deterministic replay of arbitrary actions or of the external world;
- bidirectional lenses for arbitrary schema transformations;
- engine-observed read sets for raw SQL or for an undeclared administrative,
  protected, asset, or external-effect lane;
- cross-system transactional atomicity with external providers;
- coverage of the client-side store — the client materialization, journal
  replay, and offline mutation queue remain owned by LLP 0043/0053/0090 and
  LLP 0155's client arm; this profile covers host-side durable state, and
  LLP 0161 OQ5 (which properties the client store needs natively) stays open;
  or
- one physical storage implementation shared by every deployment target.

A capability or receipt must state its lane coverage. Missing coverage is a
declared absence, not a successful empty diff or proof.

## The profile at a glance

| LLP 0161 property | Agent-safe v1 realization | Deliberate remainder |
|---|---|---|
| P1 — fork | Two declared classes: promotable current-head in-app branch (LLP 0097) and capture-only derived-deployment fork (LLP 0158, incl. checkpoint-based); class-appropriate identity; deny/capture effects; TTL/quota; journal diff; strict-CAS promotion by re-execution | Arbitrary historical branch, advanced-head promotion, merge |
| P2 — Merkle state | Complete covered-lane journal, per-commit write-set digest, boundary `ContentDigestV1`, independent verification at high-stakes boundaries | Maintained Merkle tree and arbitrary-state O(1) equality |
| P3 — provenance | One durable operation-keyed envelope record per covered durable operation | Per-row duplication of principal metadata |
| P4 — history | Named checkpoints (materialized or receipt-only, §6), fork-pinned bases, bounded record-change history under LLP 0088's invariants | General relational as-of and indefinite retention |
| P5 — read/write sets | Public normalized captured sets with per-fact provenance (server-captured vs client-supplied-validated) on paved query/mutation and dry-run paths; durable digest plus bounded detail | Raw-SQL and undeclared-lane capture |
| P6 — replay | Existing deterministic query/mutation tier plus recorded ctx answers and branch operation log; explicit effect intents/receipts | Arbitrary action and external-world replay |
| P7 — evolution | LLP 0081 proofs, rehearsal/checkpoints, compatibility decisions and refusal | General bidirectional lens runtime |
| P8 — settlement | Automatic stable operation identity and atomic receipt on ordinary covered mutations | Universalization to a lane until its conformance row is green |
| P9 — admission | Uniform authority check for covered commits, fencing where the lane defines one, and per-principal fork count, bytes, digest-work, and TTL limits | Read-side audit beyond the declared explanation surface; universal fencing on the ordinary mutation lane |

## Design

### 1. The universal commit envelope

Every covered transition across a durable boundary writes one logical
`CommitEnvelopeV1`, keyed by the operation's stable audience-scoped
`operationId`. The commit version is an association, not the key: a
data-changing operation records the stream-qualified commit version it
produced, while a receipt-only outcome — today a no-op mutation retains the
current version, and LLP 0043 recognizes an authoritative version zero for a
fresh-database no-op — records the observed snapshot version without claiming
a distinct commit. Several receipt-only operations may share one snapshot
version; no two envelopes share an operation identity. Every version fact on
the envelope, diff, and promotion surfaces is qualified by the stream identity
it belongs to, because a parent and its fork provably mint colliding version
numbers with different contents (LLP 0158's spike evidence). The artifact
schema and table names are follow-on specification work; this RFC defines the
required facts and atomicity contract. The follow-on schema marks each field
as required, required-where-the-lane-defines-one (audience fences, plan
digests), or retained-bounded (detail subject to §2 expiry).

The envelope contains or durably references:

- stream identity and the produced or observed commit/snapshot version;
- stable `operationId` and operation kind;
- principal and a non-secret session or invocation identity;
- authority audience, grant/policy identity (LLP 0055 scoped grants where the
  principal is an agent), and fencing token or epoch where the lane uses one;
- function, artifact, migration-plan, or administrative-command digest;
- canonical argument digest and, where applicable, a plan digest;
- base commit version or read baseline;
- normalized read-set and write-set digests, every fact carrying a provenance
  class — `serverCaptured`, `clientSuppliedValidated`, or
  `serverEvaluatedConditional` — so a client-supplied host-plan baseline
  (LLP 0007 §Transactions) is never presented as a server observation; LLP
  0133's claim-labeling and LLP 0146's completeness vocabulary apply rather
  than a new parallel scheme;
- bounded retained read/write details sufficient for recent explanation;
- the deterministic ctx-answer digest and retained answers required for
  supported replay;
- classified effect intents and settlement identities, without embedding
  credentials or unredacted secret payloads; and
- the terminal or pending receipt returned for this operation.

The application data change, row journal entries, commit envelope, duplicate
suppression record, and initial receipt state commit in the same physical
transaction. A commit version is not visible until all of those facts are
visible. A crash may leave none of them or all of them; it may not leave a data
change whose covered commit envelope is absent.

First-party clients mint an `operationId` before the first attempt and reuse it
across transport retries; this is a client-contract change owned by LLP
0012/0095 amendments, not by this RFC alone. Repeating an operation with the same canonical
identity and audience returns the stored receipt without re-executing. Reusing
the identity with different canonical arguments, artifact, principal audience,
or operation kind refuses with a stable mismatch diagnostic.

The envelope is operation-level metadata. Row journal records join through the
stream-qualified commit version of the data-changing operation; they do not
duplicate the principal, plan, and authority payload on every row.

#### Coverage

The initial coverage target is every ordinary paved application mutation,
including Ibex mutation execution and host-plan mutation settlement, plus
branch promotion. Read-only query execution produces explanation facts, not a
durable envelope write — only durable transitions write envelopes, keeping the
idle and read budgets intact. Existing migration, durable-background-work,
push, and auth journals remain valid specialized authorities; conformance maps
their existing receipt into the envelope vocabulary before the profile claims
those lanes. The host-plan lane's read-set provenance depends on LLP 0007's
Option A contract (pending ratification); until ratified, that lane advertises
`clientSuppliedValidated` provenance explicitly.

Actions are not declared replayable merely because an action eventually causes
a covered mutation. The durable mutation receives an envelope; the action's
ambient external observations remain outside P6 unless a separately declared
effect adapter records them.

### 2. Explanation retention

The envelope retains two forms of explanation:

1. a durable compact identity — the read/write/ctx/effect digests, provenance
   classes, and counts;
2. bounded normalized detail — the actual captured row, missing-row, predicate,
   write, and effect facts needed to explain a recent operation.

After detailed retention expires, an explanation remains honest: it returns
the durable digests, counts, coverage, and a stable `detail-expired`
disposition. It never fabricates an empty set. Named checkpoints, active forks,
open incidents, migrations, or operator pins may retain detail longer, charged
to an explicit principal or app budget.

### 3. Safe current-head forks

The v1 profile names two fork classes and refuses to blur them, because the
corpus holds two deliberately different primitives:

- The **promotable class is LLP 0097's in-app branch**: same process and trust
  boundary, the same schema/function/auth bundle as the parent (a branch
  cannot diverge them), a typed child stream over a materialized base plus
  overlay, based on the current canonical head. Only this class may promote
  (§5), which keeps re-execution against the canonical bundle well-defined.
- The **capture-only class is LLP 0158's derived deployment**: a separate
  instance with its own canonical stream and scrubbed-and-minted identity,
  which may diverge schema and functions. It never promotes; LLP 0158's
  merge-back non-goal is preserved unamended. A fork based on a named
  checkpoint is always this class — its base sits behind the canonical head,
  so strict-CAS promotion could never accept it anyway.

The `Promotable` fork class in §8 refers only to the first. Both classes
remain target-owned mechanically; the local target uses the landed LLP 0097
materialized-copy/overlay substrate and LLP 0158's F0a scrub-and-mint work
rather than a new database engine. One vocabulary dependency is inherited
rather than restated: "derived deployment" is defined by LLP 0158's OQ9
amendment to LLP 0018/0012, which is proposed-normative in a still-Draft RFC.

A profile-conforming fork of either class:

- records its parent, base version or checkpoint, coverage manifest, owner,
  creation operation, and publication receipt;
- carries class-appropriate identity: a derived-deployment fork carries newly
  minted fork identity and no reusable canonical credential (LLP 0158
  scrub-and-mint); an in-app branch carries branch-scoped authority no broader
  than its creator's current grant (LLP 0097);
- denies every unclassified host egress path and captures or simulates only
  effects whose branch adapter is explicitly declared;
- records its durable operations with the same commit-envelope vocabulary;
- has per-principal and per-app limits on live fork count, retained bytes,
  journal/digest work, and lifetime;
- is disposed by default and is reaped on TTL, never pinning the canonical
  replay floor (LLP 0088 §5's independent retention clocks; LLP 0097 §4); and
- reports host-mediated versus end-to-end isolation honestly, preserving LLP
  0097's distinction for client-initiated effects.

The first safety slice may be **deny-all egress** rather than simulated effect
success. That narrower slice is useful and honest if its capability class is
`CaptureOnly`/host-mediated and every bypass test fails closed.

### 4. Journal diff instead of maintained Merkle state

For a fork with a known base, the covered-lane journal is the primary diff
index. Each commit records a canonical write-set digest and exact changed-row
facts for its declared lanes. Fork diff enumerates those changes from the base
to the fork head and includes:

- base and head stream-qualified commit/checkpoint identities;
- covered and uncovered lanes;
- added, updated, and deleted logical rows;
- schema, system-field, asset, and effect coverage as separate facts rather
  than implied app-row coverage;
- operation and principal attribution by commit-envelope join; and
- a digest over the canonical emitted diff.

The implementation proves journal completeness for every covered write path.
An unjournaled or unclassifiable path makes the diff capability refuse or marks
the lane missing; it may not silently produce a partial result as complete.

`ContentDigestV1` remains the independent state-proof vocabulary. It is
computed at explicit high-stakes boundaries — migration rehearsal/apply,
promotion, named checkpoint, audit, or a caller-requested proof — rather than
maintained on every ordinary commit. A promotion or audit may independently
apply the expected operation/change facts to the base and compare the expected
digest with the staged actual result. A digest without an independently derived
expected value remains inventory, following LLP 0081.

The shipped `ContentDigestV1` header is migration-shaped — it binds a plan
digest, generation, barrier head, and publication version — so each new
boundary (promotion, named checkpoint, audit) must define its own
domain-separated canonical preimage and its independent expected-value
derivation before claiming proof there. A checkpoint digest without an
independent derivation remains inventory.

### 5. Promotion stays strict and merge-free

Promotion adopts LLP 0097's staged re-execution design and applies only to the
in-app branch class (§3). It never applies row post-images directly and never
invokes a storage merge.

Re-execution requires a replay-sufficient durable operation log, per LLP 0097
§5: each entry retains canonical argument values, the declared ctx answers
consumed, and any captured or simulated effect outcomes in causal order, with
transitive dependency enforcement — a write that depends on a provisional
effect outcome, directly or through a later operation that read it, stays
provisional or makes the branch non-promotable. Promotion refuses when a
required input, artifact version, or effect observation is unavailable. An
argument digest alone is not replay-sufficient.

The landed `branches::promote` path applies overlay post-images directly — the
exact mechanism this profile forbids. It is superseded, not wired: strict
promotion replaces or disables it, and the acceptance corpus keeps a negative
conformance fixture proving no product path can reach post-image promotion.

V1 promotion requires the canonical head to equal the fork's recorded base
version. It revalidates current principal, grant, policy, manifest, operation
identity, and fence; re-executes the operation log into staging; compares the
resulting write/effect facts with the fork's approved facts; and commits the
canonical data, envelope, receipt, and durable effect intents once.

If canonical state has advanced, promotion refuses and the agent creates a new
fork from the new head. This deliberately trades convenience for a small,
provable protocol. Advanced-head semantic reconciliation remains a separate
future RFC.

### 6. Bounded history and named checkpoints

The profile exposes **bounded record-change history**, not arbitrary
database-wide temporal SQL. For a covered record it can show the retained
sequence of journaled post-images/tombstones, commit provenance, operation
identity, and change disposition. Where the retention window lacks a complete
predecessor anchor, the response says so and does not claim reconstruction of
the earlier row state.

Bounded history adopts LLP 0088 §1/§5/§6 as its owning design rather than
restating a parallel one: history is per-table opt-in declared in the schema
with a bounded retention window surfaced in the manifest; v1 has no unbounded
option; a query past the retained horizon is a normal condition answered with
a stable horizon marker, not an error; and history retention and sync-resume
retention run on independent clocks — history may never pin the canonical
replay floor. LLP 0088 is Draft and gated on the LLP 0085 evidence review;
that gate is a dependency of this component, not overridden here.

A named checkpoint comes in two declared substrate classes. A **materialized
checkpoint** is a consistent physical copy taken by an explicit operation (the
local target uses SQLite's backup primitives); its cost is proportional to
database size, is charged to the retention owner, and it alone can base a
(capture-only) fork. A **receipt-only checkpoint** is a durable boundary
receipt — schema identity, stream-qualified commit version, coverage manifest,
and optional independently verified `ContentDigestV1` — with no retained
state; it supports later proof and audit but cannot materialize the past by
itself. Neither class pins the canonical replay floor: a materialized
checkpoint retains its own copy, not canonical journal history. Migration,
fork, deployment, incident, and explicit agent operations may create
checkpoints, declaring the class. A fork's pinned base is a lighter receipt of
its own materialized copy, not automatically a named checkpoint. (The corpus
uses "checkpoint" in other senses — LLP 0075's protocol checkpoints, LLP
0090's resumable query snapshots, LLP 0081's rehearsal checkpoints; a named
database checkpoint here is none of those.) A checkpoint is a
read-later/rehearsal primitive, not a promise that every intervening commit
supports relational `AS OF`.

History reads authorize fail-closed. The caller must be permitted to inspect
the relevant historical lane and record under the applicable history policy;
possession of a commit, operation, or checkpoint identifier is not authority.
Revoked credentials cannot settle effects or promote a retained fork.

Retention is always bounded unless an explicit owner pins and pays for it.
Garbage collection preserves active fork bases, named checkpoint roots, open
operation receipts, and the minimum explanation facts required by policy, then
reclaims expired detail and materialized state. Deletion and erasure
obligations override pins: a protected-lane erasure applies to retained
detail, history post-images, and materialized checkpoints, and the receipt
records the erasure rather than silently keeping the bytes.

### 7. Deterministic replay and schema evolution keep their narrower strengths

Queries and mutations retain the existing deterministic execution tier:
ambient time/randomness remain denied, declared ctx answers are recorded, and
re-execution consumes those answers. The commit envelope makes the replay
scope, artifact identity, and retained inputs discoverable. It does not turn an
action into a deterministic handler.

Branch effect handling follows LLP 0097: deny, capture, or declared simulation
inside the branch; durable fenced settlement only after canonical promotion.
An effect-outcome-dependent write remains provisional or makes the branch
non-promotable.

Schema evolution continues to use LLP 0081's typed plans, rehearsal, approval,
receipts, independent verification, compatibility decisions, and stable
refusal. This profile adds checkpoint and commit-envelope integration. It does
not add a general bidirectional-lens runtime. A future lens proposal must name a
closed transformation algebra, complement-data rules for lossy transforms,
index/query implications, and executable round-trip laws.

### 8. Capability honesty

Targets advertise orthogonal facts rather than one over-broad boolean. Exact
wire names belong to the schema follow-on, but the capability vocabulary must
distinguish at least:

- commit-envelope coverage by durable lane;
- read/write explanation detail and retention class;
- fork class (`Missing`, current-head `CaptureOnly`, or current-head
  `Promotable`) and host-mediated versus end-to-end isolation;
- diff coverage by data/effect lane;
- history class (`Missing`, bounded changes, named checkpoints);
- proof class (recorded inventory versus independent boundary proof);
- replay class (deterministic handlers versus nondeterministic actions);
- schema-evolution class (proofs with no lens claim); and
- admission/resource-bound class.

These axes register as `TargetCapabilityId` entries under LLP 0134's
capability-maturity machinery — with its soak, promotion-registry, and
demotion obligations — rather than as a parallel reporting surface. The
aggregate `AgentSafeV1` profile may be claimed only when every required
component and its coverage manifest pass the acceptance corpus under LLP
0134's rules. A target with a missing component advertises the individual
capabilities it actually has.

### 9. Storage engine and portability

Stock SQLite remains the canonical local physical engine. This RFC introduces
no new page format, WAL, query planner, temporal table layout, or mandatory
storage server. It preserves application-shaped SQL tables and the direct local
inspection/brownfield properties valued elsewhere in the corpus.

The portable contract is the operation/envelope/fork/diff/history/proof
semantics, not SQLite copying, filesystem reflinks, Durable Object bookmarks,
Postgres schemas, or a vendor-specific Merkle root. Each target owns its
mechanics and passes the same semantic corpus before advertising parity.

Dolt, DoltLite, another version-native engine, or a Snapback-maintained Merkle
layer may be evaluated as an opt-in target or future implementation. No v1
receipt, proof, cursor, or application API depends on one, and adopting one is
not part of this RFC.

## Performance and simplicity budget

The profile earns its 80/20 label only if the common path stays simple and
measured.

### Structural budget

- Ordinary current-state reads add no history join, temporal predicate,
  Merkle-root lookup, branch overlay, or extra storage round trip.
- Ordinary covered writes add a bounded number of metadata records plus detail
  proportional to the captured read/write/effect facts. They perform no
  full-table scan and no per-row Merkle-ancestor update.
- Full content digest computation, checkpoint copying, and historical
  materialization are explicit operations with progress and resource budgets.
- Fork and retention garbage collection are demand-driven or bounded; they do
  not introduce idle polling or periodic writes on an idle local app.
- Explanation payloads and effect observations are size-bounded and redact or
  refuse secrets rather than turning provenance into an unbounded data lake.

### Measurement gate

Before the local target may advertise any `AgentSafeV1` component above
`Missing` (the claim boundary in §Summary; document status and capability
status stay separate facts), the same binary and fixture must compare
profile-off versus profile-on for:

- current-state point/range/query-plan reads;
- warm-VM single-writer mutation throughput and p50/p95 latency;
- fan-out cost for the existing local benchmark shapes;
- bytes written and retained per changed logical row and per operation;
- idle CPU, resident memory, and disk writes;
- fork creation, diff, promotion, and TTL-reap latency at representative data
  sizes; and
- crash/reopen behavior at every envelope, publication, promotion, and effect
  settlement cut.

The measurement protocol is LLP 0035's: dated baseline artifacts from the
shipped bench-harness fields, a fixed fixture and hardware class, enough runs
to state a median and spread, and a per-metric verdict rather than one blended
number. The proposed initial guardrail is: no statistically meaningful
read-path regression, no new idle CPU or disk writes, and no more than a 15%
regression in warm single-writer throughput and in mutation latency (p50 and
p95, each judged individually) against the named baseline artifact. A larger
measured cost requires explicit author ratification recorded next to the
baseline and a documented benefit; it is not silently absorbed into the
profile.

## Security and privacy

- Envelopes store identities and canonical digests, not reusable credentials.
- Raw arguments, ctx answers, read/write details, and effect observations are
  classified before retention; secret or regulated content is redacted,
  encrypted in its owning protected lane, or refused.
- Explanation, diff, history, and checkpoint reads authorize separately from
  current application reads and fail closed when the target cannot prove the
  required policy.
- Authority is checked at initial admission, promotion, and each asynchronous
  effect attempt. Historical authority is evidence, never automatically reused.
- Operation identity does not grant authority and does not make a secret
  receipt publicly discoverable. The envelope is evidence, never a second
  authority: no authorization decision may be derived from envelope contents.
- Digests over low-entropy arguments or identities are domain-separated and,
  where exposure would create an offline guessing oracle, keyed.
- Quotas cover live forks, retained bytes, history pins, digest work, effect
  captures, and explanation detail; exhaustion produces stable diagnostics and
  never degrades into an unbounded best effort.

## Acceptance

The profile is not implemented until executable evidence proves all of the
following on the local reference target:

1. **Atomic envelope:** crash cuts around a covered mutation reveal either no
   data/journal/envelope/receipt change or the complete committed set.
2. **Retry settlement:** identical retries return the stored receipt without a
   second write; identity reuse with changed arguments, artifact, audience, or
   kind refuses stably; receipt-only operations sharing one snapshot version
   keep distinct envelopes keyed by operation identity.
3. **Provenance and explanation:** a committed row change joins to its
   operation, principal, authority, artifact, and retained read/write facts;
   expired detail reports `detail-expired`, not an empty explanation.
4. **Coverage honesty:** every declared lane has positive and bypass fixtures;
   an undeclared or unjournaled lane cannot produce a complete diff/proof claim.
5. **Fork isolation:** proved per class — in-app branch writes over the
   materialized base plus overlay are invisible to canonical and sibling
   branches, and derived-deployment fork isolation is proved under its own
   declared model; canonical writes after the base are invisible to the
   materialized base in both classes.
6. **Effect quarantine:** every host egress family is denied or, where the
   class declares capture, captured in the fork, with negative bypass tests;
   client-side scope is reported separately.
7. **Identity and authority:** canonical credentials are absent from the fork;
   revoked or stale authority blocks promotion and later effect settlement.
8. **Resource containment:** count, byte, digest, and TTL limits refuse or
   reap deterministically; after any reap or expiry the canonical replay floor
   equals its value as computed from sync-resume retention alone (LLP 0088
   §5's independent clocks).
9. **Exact fork diff:** randomized covered writes compare the journal-derived
   diff with an independent base/head logical comparison, including deletions,
   missing rows, schema/system coverage, and multiple commits.
10. **Strict promotion:** an unchanged-base branch re-executes into staging
    and commits once; any advanced canonical head refuses; contingent effect
    state remains provisional through settlement, including LLP 0097's
    transitive fixture where a chain of operations dependent on a provisional
    effect outcome stays provisional together; and no product path can invoke
    the superseded post-image promotion.
11. **Bounded history and checkpoint:** retained row changes and named
    checkpoint receipts survive crash/reopen, authorize fail-closed, and expire
    or remain pinned according to policy.
12. **Boundary proof:** migration/promotion/checkpoint fixtures independently
    derive expected values and compare them with actual `ContentDigestV1`
    under each boundary's domain-separated preimage (§4); inventory-only
    digests cannot be presented as proof.
13. **Performance budget:** the measurement gate above is published and passes
    or any exception is explicitly ratified.

Hosted targets remain `Missing` for each unproved capability until they pass the
same semantic fixtures with target-specific crash and resource tests.

## Sequencing

This is dependency order, not implementation authorization. LLP 0130's
standing decisions, LLP 0129's admission machinery, and LLP 0155's program
direction own commissioning; LLP 0158's F0a is the sole live adjacent lane
today, and it deliberately excludes capture-ledger integration and promotion.
Steps that alter ordinary mutation identity, settlement, wire shapes, or
client behavior land as dated amendments to their owning documents — LLP
0051/0129/0133 for settlement, LLP 0043/0053/0090 for retention, LLP 0094/0095
for wire and lifecycle, LLP 0012 for client conformance — not by centralizing
those contracts here.

1. Make `operationId` automatic on first-party ordinary mutations and unify
   their duplicate-suppression/receipt behavior with the existing settlement
   vocabulary.
2. Add the operation-level provenance record and public explanation surface
   over existing captured read/write facts.
3. Wire the current-head fork through identity scrub-and-mint, deny-all egress,
   publication recovery, registry/TTL, and resource bounds, coordinated with
   LLP 0158's F0a program.
4. Record fork operations with the envelope and expose the exact coverage-aware
   journal diff.
5. Wire LLP 0097's host-egress mediation and capture-ledger integration — the
   prerequisite LLP 0097 defines and F0a deliberately cut — so branch effect
   capture exists before promotion depends on it.
6. Wire strict-CAS staged promotion by re-execution over a replay-sufficient
   operation log, including provisional effect state and fenced settlement,
   replacing or disabling the post-image `branches::promote` path.
7. Add bounded record-change history, named checkpoints, retention pins, and
   boundary proof integration.
8. Re-run the measurements and decide the revisit triggers below from evidence.

## Revisit triggers

### Incremental Merkle state

Reopen P2's maintained-tree design when one of these is measured:

- journal-derived fork diff misses its latency or memory target at a real
  subscriber/data size;
- agents frequently compare states without an ancestor/base relationship;
- boundary full-digest cost dominates migration, promotion, or checkpoint UX;
- retained journal pins cost more than a maintained partitioned digest would;
  or
- a stable version-native engine passes Snapback's local performance,
  durability, packaging, inspection, and portability gates with less total
  owned complexity than the overlay design.

The first escalation should evaluate coarse stable key-range partitions before
a general immutable Merkle DAG.

### Database-wide as-of

Reopen P4(c) when multiple real incidents or workflows cannot be served by
operation explanation, bounded record history, named checkpoints, or
fork-at-checkpoint. A reopening must price historical schema semantics,
authorization, deletion/erasure, GC, backup amplification, and query latency.

### Schema lenses

Reopen P7's lens half when measured client-version overlap makes mixed-schema
read/write populations a steady state and LLP 0081's compatibility decisions,
staged generations, and refusal behavior cannot serve it. A reopening begins
with a closed transform algebra and round-trip laws, not a general lens claim.

### Universal action replay

Reopen full P6 for actions when a concrete incident needs reproduction beyond
the deterministic handler tier and effect receipts. The proposal must address
large/streaming responses, secrets, retention, provider ambiguity, and whether
recording an observation is semantically sufficient.

## Open questions

1. What are the default detail-history and named-checkpoint retention windows,
   and which principals may extend them?
2. Which exact ordinary and specialized lanes are mandatory for the first
   aggregate `AgentSafeV1` claim rather than advertised separately?
3. Which read/write explanation details remain stored verbatim, which are
   canonical digests only, and which require protected-lane custody?
4. Does the proposed 15% local mutation budget match the workload value, or
   should acceptance use a different ratified threshold after an initial
   instrumentation-only measurement?
5. Which document owns the committed artifact schemas and capability-manifest
   extension: this RFC after acceptance, LLP 0037's generated-schema pattern,
   or a focused follow-on Spec — and how do the §8 `TargetCapabilityId`
   registrations interact with LLP 0134's soak windows?
6. Is LLP 0007's Option A host-plan contract ratified before the P5
   explanation surface ships, or does making that lane's provenance public
   force the ratification?
7. Which existing specialized receipts can map losslessly into the universal
   envelope, and which need an explicit compatibility/version bridge?
8. When LLP 0088's 0085-gated evidence review lands, does its history design
   supersede §6's normative import verbatim, or does this profile keep an
   independent restatement?

## Status

**Draft.** This RFC proposes the bounded implementation profile derived from
LLP 0161. It neither changes the current canonical local target nor claims that
the profile ships. Acceptance should follow a cross-family review because the
RFC joins storage correctness, authority, effects, retention, and performance
on the ordinary write path.
