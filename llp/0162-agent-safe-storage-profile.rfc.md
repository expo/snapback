# LLP 0162: Agent-safe storage profile

**Type:** RFC
**Status:** Accepted
**Systems:** Storage, Runtime, Sync, Auth, Effects, Migrations, Agent experience, Diagnostics, Testing, Performance
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-03
**Revised:** 2026-08-03 (v0.9 — **Accepted by Charlie** after the seven-round super-refine loop (see `llp/reviews/0162-agent-safe-storage-profile.super-refine.md`), with three author decisions applied: OQ11 decided — an agent principal holding an LLP 0055 scoped grant may approve a `PromotionRequestV1`; OQ14 executed — the identity/envelope, fork/promotion, and proof/checkpoint contracts are extracted to LLP 0163/0164/0165 with this RFC as the profile umbrella; the commissioned dated amendments landed in LLP 0097, 0133, 0043, 0012, and 0095. Acceptance changes the document's status only: every capability remains `Missing` until the acceptance corpus passes (§Summary claim boundary), and the step-0 baseline artifact, the OQ13 snapshot-pinning spike, and LLP 0163-0165's own acceptance still gate advertisement); 2026-08-03 (v0.8 — final targeted repair from the seventh, delta-scoped cross-family round (repairs unreviewed; the loop closed at the declared stopping rule): re-seal widened to the full approved-facts digest (reads, ctx answers, decision/result facts, writes, effects, coverage) with the original approval preserved and re-seal as a separately identified engine attestation; identity tombstones retained until the epoch floor passes, closing the two-identity/same-epoch hole, with `result-expired`-before-`identity-horizon-passed` lookup precedence; journal completeness re-founded on an enforceable write-authority choke point (generated transaction API + SQLite authorizer) with an honest enumerated-fixture fallback class; post-expiry aggregate explanation gets `authorization-unprovable` fail-closed; promotion durably copies replay-log envelope facts into canonical; the aggregate promotion identity pinned to the rebase-invariant admission ticket; head reservation quotaed with a p99 contention metric and TTL-sufficiency condition; 0158 sentinel + intra-state crash matrix imported into Acceptance 12 with the registry-authority deviation declared; effect facts split into egress-family and 0066 settlement-capability axes; offline range exhaustion dispositioned; `verifiedCopyFidelity` named as its own proof class; per-component performance gating clarified; legacy `Missing` projection rationale recorded); 2026-08-03 (v0.7 — sixth cross-family review round applied: `PromotionRequestV1` re-seals automatically across rebase when re-execution reproduces the approved facts; promotion's admissible identity unified on the aggregate (per-source identities demoted to non-admissible write-fact-granularity provenance joins, Acceptance 3 carved); liveness weakened to declared conditional fairness with a bounded head-reservation escalation and ticket-lifetime/budget terms; offline minting closed via server-preallocated authenticated finite identity ranges; epoch closure defined on acknowledgement with the crashed-client wedge stated; the `result-expired` middle-regime disposition named and amended; checkpoint claims re-scoped to verified copy fidelity with 0158's publication state machine imported and the snapshot-pinning spike named; journal completeness given a closed write-path-registry derivation; the non-row authorization rule owned here; derived-deployment fork support moved out of core into a 0158-gated additive capability; `Promotable(noEffects)` named as a strictly narrower claim with a conservative legacy projection; index costs split; OQ4 authority corrected); 2026-08-03 (v0.6 — fifth cross-family review round applied: identity keyspace partitioned by originator class with server-authenticated host derivations (squatting foreclosed); envelope compact identity given a bounded retention clock independent of the resume floor and journal prune, with asymmetric-join dispositions; non-row authorization dropped to LLP 0088's current-policy rule with the residual named; `DenyAll` records a bounded payload-free attempt marker so no-egress promotion is provable; `PromotionRequestV1` seals the reviewed branch head and promotion commits one canonical transaction with an aggregate envelope; epoch issuance server-recorded so closure sees minted-not-just-admitted identities; §8 provenance claim replaced by a per-component owner/status table and the 0097 amendment scope widened to every touched section; FIFO admission tickets held across rebase with a concurrency-scaled budget and progress fixture; pins made finite renewable leases; exception authority corrected to dated author ratification with a hard ceiling; bounded envelope enumeration added; per-class credential acceptance; sequencing step-3(a)/5(a) duplication fixed); 2026-08-03 (v0.5 — fourth cross-family review round applied: audience decided to be a bound compared fact, not a key component (LLP 0133's collision rule preserved; key = stream-qualified operation identity, promotion identities derived from the globally non-reusable `childStreamId`); the epoch floor given an issuer/closure/advancement protocol that cannot strand in-flight identities; a dated proposed-normative amendment to LLP 0097 §Capability classes declared for the axis split and `DenyAll`; promotion contention answered with serialized admission and a bounded rebase budget; checkpoint dual-path proof pinned to one source snapshot; non-row fact authorization made current-plus-captured; the core tier's per-version rule owned by this RFC; aggregate membership and performance thresholds closed with LLP 0130 as exception authority; sequencing gains a baseline step 0 and splits mediation from capture-ledger work); 2026-08-03 (v0.4 — third cross-family review round applied: envelope/suppression identity stream-qualified with branch-local namespaces and deterministic promotion re-mint; suppression reclamation restricted to acknowledged receipts plus an epoch-bearing anti-replay floor, `identity-horizon-passed` reclassified as outcome-unknown; per-fact-class authorization for non-row explanation facts; fork capability split into orthogonal axes (egress/promotion/base/isolation) with no-egress `DenyAll` branches promotable; `AgentSafeV1` layered into a core aggregate, an app-effective conformance fact, and a history tier gated on LLP 0088; checkpoint dual-path proof derivation and erasure/custody protocol; measurement gate scoped per component against the dated baseline; rebase-by-replay affordance; uncovered-lane co-writes make a branch non-promotable); 2026-08-03 (v0.3 — second cross-family review round applied: `operationId` defined as the shipped `ClientMutationIdentity` widened (LLP 0133's extend-don't-ride-beside discipline) with per-originator identity sources and a bounded suppression lifecycle after LLP 0043's settlement pattern; LLP 0088 §6's per-post-image authorization rule imported verbatim with elision fixtures; the diff surface split into attributed change sequence versus net state diff with first-write-preimage/immutable-base requirement and canonical folding; deny-all egress renamed `DenyAll` (CaptureOnly reserved for 0097's ledger-backed meaning); "covered" given a definition; §8 given a base-class axis, a manifest-extension relationship to LLP 0134, and a closed v1 aggregate matrix; performance gate re-founded on a dated statistically controlled baseline artifact; `branches::promote` reframed as a deviation from Accepted LLP 0097 and ticketed there); 2026-08-03 (v0.2 — first cross-family review round applied: envelope keyed by operation identity with the commit version demoted to a stream-qualified snapshot association; the promotable fork class pinned to LLP 0097's in-app branch, with LLP 0158 derived-deployment forks capture-only; named checkpoints split into materialized and receipt-only substrate classes; per-fact read-set provenance discriminators per LLP 0007/0133/0146; LLP 0088's history invariants imported normatively; replay-sufficient promotion record required and the landed post-image `branches::promote` path marked superseded; capability claims routed through LLP 0134; commissioning authorities and amendment ownership named)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0012, LLP 0017, LLP 0018, LLP 0024, LLP 0035, LLP 0036, LLP 0037, LLP 0042, LLP 0043, LLP 0051, LLP 0053, LLP 0055, LLP 0066, LLP 0070, LLP 0072, LLP 0081, LLP 0088, LLP 0090, LLP 0094, LLP 0095, LLP 0097, LLP 0129, LLP 0130, LLP 0133, LLP 0134, LLP 0146, LLP 0155, LLP 0158, LLP 0159, LLP 0160, LLP 0161

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

The profile intentionally implements P1, P3, P5, and P8 strongly on their
declared paved paths, and P9 strongly on its declared admission and
containment surface (ordinary-mutation fencing and read-side audit remain
deliberate remainders); preserves the already-strong deterministic-handler and
migration-proof halves of P6 and P7; and substitutes journal-based diff plus
named checkpoints and bounded change history for full P2 and P4. It does not
change LLP 0088's rejection of merge as sync-core machinery. A successful fork
is kept by LLP 0097's promotion-by-re-execution path, never by storage merge.
The promotable fork class is LLP 0097's in-app branch; LLP 0158's
schema/function-divergent derived-deployment forks remain non-promotable in
v1, preserving LLP 0158's merge-back non-goal unamended.

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
by the optional `clientMutationId` — the transport client defaults it off,
while the first-party React optimistic path already mints one);
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
| P1 — fork | Two declared classes (§3); deny/capture effects; TTL/quota; journal diff; strict-CAS promotion by re-execution with serialized admission (§5) | Arbitrary historical branch, advanced-head promotion, merge |
| P2 — Merkle state | Complete covered-lane journal, per-commit write-set digest, boundary `ContentDigestV1`, independent verification at high-stakes boundaries | Maintained Merkle tree and arbitrary-state O(1) equality |
| P3 — provenance | One durable operation-keyed envelope record per covered durable operation | Per-row duplication of principal metadata |
| P4 — history | Named checkpoints (materialized or receipt-only, §6), fork-pinned bases, bounded record-change history under LLP 0088's invariants | General relational as-of and indefinite retention |
| P5 — read/write sets | Public normalized captured sets with per-fact provenance (server-captured vs client-supplied-validated) on paved query/mutation and dry-run paths — durable digest plus bounded detail on mutations, response-scoped explanation on queries and dry-run | Raw-SQL and undeclared-lane capture |
| P6 — replay | Existing deterministic query/mutation tier plus recorded ctx answers and branch operation log; explicit effect intents/receipts | Arbitrary action and external-world replay |
| P7 — evolution | LLP 0081 proofs, rehearsal/checkpoints, compatibility decisions and refusal | General bidirectional lens runtime |
| P8 — settlement | Automatic stable operation identity and atomic receipt on ordinary covered mutations | Universalization to a lane until its conformance row is green |
| P9 — admission | Uniform authority check for covered commits, fencing where the lane defines one, and per-principal fork count, bytes, digest-work, and TTL limits | Read-side audit beyond the declared explanation surface; universal fencing on the ordinary mutation lane |

## Design

### 0. Defined terms

**Covered.** A lane is *covered* exactly when it has a declared entry in the
target's coverage manifest, a journal-completeness proof for every write path
in the lane, and an envelope mapping. Coverage is declared per lane, surfaced
in the capability manifest, and changed only by a dated manifest change.
Artifacts — envelopes, diffs, proofs — bind the coverage-manifest version in
force at emission and are never retroactively requalified; whether a crash cut
or a missing envelope is a defect is judged against the manifest in force at
the time of the write. Related terms carry their owners' definitions: *lane*
(a declared family of durable write paths sharing custody and journal
treatment), *stream identity* (LLP 0158's per-instance version stream),
*paved path* (the supported authoring surface per LLP 0004/0007).

**Egress classes.** `DenyAll` refuses every host egress attempt fail-loud and
records a bounded, payload-free **attempt marker** (egress family and count,
no intent payload) durable in the branch — so "no egress was attempted" is
provable even when a handler catches the refusal and continues; `CaptureOnly`
(LLP 0097's ledger-backed meaning, reserved) records each denied effect as an
inspectable durable intent. The distinction
is load-bearing in §3, §5, §8, and §Sequencing and always carries this
definition.

**Other terms.** *Audience* is LLP 0133's authority-instance descriptor
scope. *Originator class* is the identity-source class of §1 (client-minted
versus host-derived). *Protected-lane custody* is the encrypted,
access-controlled storage class for secret-bearing retained content; its
schema and ownership land with OQ5's follow-on Spec.

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

The operation identity **extends the shipped `ClientMutationIdentity`** under
LLP 0133's discipline (extend, never ride beside): `operationId` is the
existing `clientMutationId` widened to every originator, and the canonical
identity continues to bind every semantics-affecting fact the shipped path
binds today — enumerated in LLP 0133 §Exactly-once identity, including the
function, auth fingerprint, authority-instance descriptor, input fingerprint
over `{args, readSet, ctxLedger}`, the settlement carrier where it diverges
from the default, and 0133's lane and claim additions. The audience is a
**bound compared fact, not a key component**: LLP 0133's collision rule is
preserved unamended, so re-presenting an identity under a divergent audience,
principal, or any other bound fact fails closed in the shipped
`SNAPBACK_CLIENT_MUTATION_ID_REUSED` / stale-authority diagnostic families —
it never executes as novel and never returns another audience's receipt. The
physical key is the stream-qualified, originator-partitioned operation
identity: envelopes and
suppression records live in the namespace of the stream that executed them
and of the originator class that minted them, so `(streamId,
originatorClass, operationId)` is the full key. The host-derived namespace is
unwritable by client-originated admission, and host-derived identities are
additionally server-authenticated under the issuing authority (the same
binding the epoch protocol uses), so a client cannot pre-claim — squat — the
identity a future cron occurrence, job attempt, or migration step will
deterministically derive. Branch envelopes are
branch-local and are discarded at teardown. Promotion does not replay the
branch's identities into canonical, and it has exactly one admissible
identity: the aggregate promotion identity on the `PromotionRequestV1` (§5)
is the sole key that participates in duplicate suppression, collision
comparison, retention floors, and receipt lookup — a post-promotion retry of
it returns the aggregate receipt. The per-source identities derived from
`(childStreamId, sourceOperationId)` are **non-admissible provenance join
records**, recorded atomically with the aggregate envelope at write-fact
granularity so every journaled row joins to the branch operation that
produced it; they never suppress or answer a retry. `childStreamId` is
globally non-reusable — minted once with
collision-resistant randomness (LLP 0148's grammar) and never reissued across
teardown, restore, or registry reconstruction — so a re-created branch cannot
collide with an earlier promotion's records, and re-execution is
never suppressed by the branch's own receipts. The widening lands as
dated amendments to LLP 0133/0043, which remain the duplicate-suppression
authority.

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
- the deterministic ctx-answer digest and, for lanes claiming replay, the
  ledger retained verbatim — the retention selection rule is the lane's
  declared replay class, not an unstated subset;
- classified effect intents and settlement identities, carrying **two
  orthogonal classification axes**: the egress family (the branch
  substrate's closed enum, which the `DenyAll` attempt marker records) and
  LLP 0066's settlement capability (`transactional | provider-idempotent |
  provider-queryable | compensatable | inherently-ambiguous`, not yet an
  owned taxonomy), the latter being what §5's promotability and provisional
  rules turn on; credential/egress seam per LLP 0036; without embedding
  credentials or unredacted secret payloads; and
- the terminal or pending receipt returned for this operation.

The application data change, row journal entries, commit envelope, duplicate
suppression record, and initial receipt state commit in the same physical
transaction. A commit version is not visible until all of those facts are
visible. A crash may leave none of them or all of them; it may not leave a data
change whose covered commit envelope is absent.

Identity source is defined per originator class. Client-originated operations
carry a client-minted `operationId` before the first attempt, reused across
transport retries — a client-contract change owned by LLP 0012/0095
amendments. Host-initiated operations — cron occurrences, durable jobs,
migration steps, administrative commands — derive their identity
deterministically from a durable upstream identity (job id plus
attempt-invariant key, cron occurrence, migration operation id), never minted
fresh per attempt, so a host-side retry after a crash returns the stored
receipt; an operation producing multiple durable commits derives a child
identity per commit from the parent identity plus a stable ordinal. The transition is versioned: once a target advertises envelope
coverage for a lane, an ordinary mutation arriving on that lane without an
identity refuses stably rather than executing uncovered, and legacy clients
negotiate the prior contract until the amendment's cutover. Repeating an
operation with the same canonical identity and audience returns the stored
receipt without re-executing. Reusing the identity with any divergence in the
bound identity facts — arguments, read baseline, ctx ledger, artifact,
principal audience, or operation kind — refuses with the shipped stable
mismatch diagnostics.

Duplicate suppression is bounded by an explicit lifecycle that preserves LLP
0043's shipped rule rather than weakening it: an *unacknowledged* receipt is
never evicted — at capacity, admission of new identities refuses rather than
reclaiming old results, exactly 0043's refuse-at-capacity bound. Reclamation
applies only to receipts already acknowledged, or removed by an operator
purge that explicitly admits forfeiting exactly-once. Because a reclaimed
identity would otherwise be indistinguishable from a novel one, identities
carry a structured issuance epoch with a defined protocol. Epochs are
server-issued and authenticated, bound to the issuing authority instance or
session incarnation, so a client that loses its local store obtains a new
session and therefore a new epoch — client-local state never fabricates
monotonicity. Offline minting is closed by construction: at session open the
server preallocates an authenticated **finite identity range** (epoch plus
counter range) that the client persists atomically before use; offline
mints draw from the persisted range, so the server knows the last-issuable
bound at preallocation and closure can conservatively bound every
minted-but-never-delivered identity by the range without a mint-time
round trip. A client that exhausts its range while offline queues further
intents locally as uncovered and refreshes the range at reconnect before
admission — a stable, disclosed degradation, with the range size and window
owned by the dated LLP 0043/0012/0095 amendments. A client that loses its
store obtains a new session and range.
An epoch **closes** only when both hold: its issuer is
terminated or revoked, so no new first attempts can be minted under it, and
every identity in its preallocated ranges is admitted-and-**acknowledged**
(LLP 0043's acknowledgement, not any weaker "settled"), never-admitted and
expired by the range's declared window with an explicit outcome-unknown
classification, or operator-purged. Two consequences are stated plainly: a
minted-but-never-delivered identity either holds its epoch open or is
classified outcome-unknown by name — never silently reclassified below the
floor — and an admitted-but-unacknowledged identity holds its epoch open
until operator purge, which is LLP 0043's own posture (a crashed client
wedges only its audience's floor, bounded by refuse-at-capacity, never by
eviction). The
per-audience minimum accepted epoch advances only past closed epochs, which
makes stranding impossible by construction: an in-flight first attempt under
an open epoch is always admissible, and a single unacknowledged identity
holds its epoch open (bounded by the refuse-at-capacity rule, not by
eviction). A retry bearing an epoch below the floor refuses with a stable
`identity-horizon-passed` diagnostic rather than silently re-executing; the
diagnostic is an explicit outcome-unknown disposition, not a typed failure —
clients must not record it as a terminal `failed` result, and the dated LLP
0043/0012/0095 amendments define its client handling. Restamping an old
`operationId` under a newer epoch is a distinct admission, safe because
reclamation is post-acknowledgement: the acknowledging client already
observed the outcome, so a restamp is a client-contract violation that at
worst executes a new operation, never a silent duplicate settlement. The
compact envelope identity (§2) may outlive the suppression record; it
retains the terminal outcome (committed or refused) and the receipt digest,
so while it survives, a retry receives a stable `result-expired` answer —
outcome-known, payload gone — which is a client-visible contract change from
LLP 0043's republish-the-stored-result rule and lands in the same dated LLP
0043/0012/0095 amendments as `identity-horizon-passed`. The floor is not the
only guard: when an identity's last durable record would otherwise be
reclaimed while its epoch is still open, a payload-free **identity
tombstone** (identity digest plus terminal outcome class) is retained until
the audience floor has advanced past the epoch — so a reclaimed identity in
an open epoch can never re-execute as novel. Lookup precedence is defined:
suppression record, then compact envelope or tombstone (`result-expired`),
then the epoch floor (`identity-horizon-passed`). Host-originated epochs are
issued by the server's own incarnation and close on incarnation rotation
under the same rules. P8 is advertised with these bounds, never as an unbounded promise.

The compact envelope identity has its own bounded retention clock — the
profile's third, and it is declared like the other two: a per-audience
envelope-identity window, independent of the sync-resume replay floor (which
it may never pin) and of the journal prune predicate. On covered lanes the
envelope window is at least the journal window, so a journal row never
outlives the envelope that explains it; the reverse — an envelope surviving
its journaled rows — answers explanation with the digests, counts, and a
stable `journal-expired` disposition rather than fabricating detail.

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
disposition. It never fabricates an empty set. Detail may also be bounded at
capture time: when captured facts exceed the declared per-operation detail
budget, the durable digests and counts are still recorded and the explanation
carries a stable `detail-truncated` disposition — truncation is disclosed,
never silent. When constituent facts are gone and their per-fact
authorization can no longer be evaluated under current policy, the
explanation returns only non-sensitive operation metadata with a stable
`authorization-unprovable` disposition — retained counts and membership
digests are withheld fail-closed rather than disclosing facts whose
authorization cannot be proved. Query explanation is response-scoped and non-durable (§1
Coverage); the capability manifest distinguishes mutation-durable from
query-ephemeral explanation. The explanation surface also supports bounded
enumeration — listing operations by principal, session, or time range within
the retention window, under the same fail-closed authorization — because an
agent that lost its context has lost its `operationId`s, and "what did I do"
is the question the substrate exists to absorb; the enumeration index's cost
is named in the structural budget. Named checkpoints, active forks,
open incidents, migrations, or operator pins may retain detail longer, charged
to an explicit principal or app budget; every such pin is a finite renewable
lease with a mandatory maximum lease duration, never an unbounded hold.

### 3. Safe current-head forks

The v1 profile names two fork classes and refuses to blur them, because the
corpus holds two deliberately different primitives:

- The **promotable class is LLP 0097's in-app branch**: same process and trust
  boundary, the same schema/function/auth bundle as the parent (a branch
  cannot diverge them), a typed child stream over a materialized base plus
  overlay, based on the current canonical head. Only this class may promote
  (§5), which keeps re-execution against the canonical bundle well-defined.
- The **non-promotable class is LLP 0158's derived deployment**: a separate
  instance with its own canonical stream and scrubbed-and-minted identity,
  which may diverge schema and functions. It never promotes; LLP 0158's
  merge-back non-goal is preserved unamended. A fork based on a named
  checkpoint is always this class in v1 — its base sits behind the canonical
  head, so strict-CAS promotion could never accept it anyway, and LLP 0097
  deliberately defers historical-base in-app branches rather than defining
  them, so the derived deployment is the only primitive the corpus offers for
  a checkpoint base today. A non-promotable in-app branch at a checkpoint
  base would need a dated LLP 0097 amendment and is not proposed here. The
  scrub-and-mint produces a new stream identity for the fork; the fork
  receipt records the parent stream identity so parent envelopes remain
  joinable as evidence.

Promotion applies only to the first class. Nested forks are out of scope in
v1: a fork may not itself be forked. Both classes
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

Promotability is also a retention fact: at admission, each branch operation's
replay inputs (canonical arguments, ctx answers, effect observations) are
classified under the LLP 0043/0053 retention rules and the protected-lane
custody rules (LLP 0146 supplies the dry-run/explanation vocabulary, not the
retention contract); an operation whose inputs cannot be retained transitions the branch to
non-promotable immediately, recorded on the branch receipt. In a derived
deployment, every profile store — envelopes, suppression records, history,
checkpoints — is classified by LLP 0158's mechanical custody sweep (copy,
scrub, rotate, or refuse) like any other `_snapback_*` table.

The first safety slice may be **deny-all egress** rather than capture or
simulated effect success. That narrower slice is useful and honest only under
its own name: its capability class is `DenyAll`/host-mediated — `CaptureOnly`
stays reserved for LLP 0097's ledger-backed meaning, where denied effects are
recorded as inspectable durable intents — and every bypass test fails closed.
F0a's deny-all posture is the *derived-deployment* class's `DenyAll` slice —
its implementation status is F0a's to report. The in-app branch's equivalent
egress mediation is LLP 0097's own prerequisite, is unbuilt, and is
sequencing step 5(a); a step-3(a) branch cannot execute egress-bearing paths
until 5(a) lands. The capture ledger is deferred work for both classes.

### 4. Journal diff instead of maintained Merkle state

For a fork with a known base, the covered-lane journal is the primary diff
index. Each commit records a canonical write-set digest and exact changed-row
facts for its declared lanes.

The diff surface is two distinct products, named separately even where they
share machinery: an **attributed change sequence** — the ordered
journal-derived list of committed changes with operation and principal
attribution — and a **net base-to-head state diff**. The net diff cannot be
derived from post-image journals alone: update-then-revert, insert-then-delete,
and delete-then-reinsert are indistinguishable from net change without the
base value, and the landed substrate's materialized copy becomes the writable
fork (LLP 0158's spike records the same fact for backup destinations), so the
base is not implicitly retained — a doc/code divergence worth naming: LLP
0097 §Design 1 reads as an immutable base plus overlay, and the landed
`MaterializedBase` comment says the copy is the writable fork; the divergence
is recorded in 0097's implementation lane alongside the promote deviation. A net-diff claim therefore requires an
immutable retained base or first-write preimages recorded per row within the
fork. Each target chooses its substrate — immutable base or first-write
preimages — provided the diff receipt names the choice and the same folding
corpus passes. Net-diff folding is canonical: update-then-revert folds to no
change; insert-then-delete folds to nothing; delete-then-reinsert of an
identical row folds to no change and of a different row to an update; system
fields state their own coverage. Sibling forks of one base are compared
through that common base (each diffs to the base; the diffs are compared) —
v1 offers no direct cross-fork comparison primitive, and frequent
no-common-ancestor comparison is precisely the Merkle revisit trigger's
escalation signal.

Fork diff enumerates those changes from the base
to the fork head and includes:

- base and head stream-qualified commit/checkpoint identities;
- covered and uncovered lanes;
- added, updated, and deleted logical rows;
- schema, system-field, asset, and effect coverage as separate facts rather
  than implied app-row coverage;
- operation and principal attribution by commit-envelope join; and
- a digest over the canonical emitted diff. At runtime that digest is
  **inventory** in v1 — Acceptance 9's independent comparison is a
  fixture-time property, not a runtime derivation — except at the promotion
  boundary, where §5's staged re-execution comparison supplies the
  independently derived expected value; §8's proof class advertises the diff
  surface accordingly.

Journal completeness has a named, enforceable derivation, not fixture
enumeration: covered-lane physical writes pass through a single **write
authority choke point** — a generated transaction API (LLP 0037's
schema-generated pattern) holding an unforgeable lane-writer token — and a
SQLite authorizer denies any write to a covered table arriving outside that
seam, so "complete" means every physical write provably transits the
journaling path, with a compile-level negative fixture (direct SQL to a
covered table is denied) and runtime refusal for anything unregistered.
Until that seam lands, completeness claims honestly downgrade: the diff and
coverage capabilities advertise the enumerated-fixture inventory class, not
completeness.
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
digest, generation, barrier head, publication version, and also the
algorithm version, schema hash, qualified table, and publication timestamp
(the preimage is migration-instant-bound, not merely migration-shaped) — so each new
boundary (promotion, named checkpoint, audit) must define its own
domain-separated canonical preimage and its independent expected-value
derivation before claiming proof there — with golden vectors committed per
domain before any caller wires in; the promotion digest domain itself
(canonical header, preimage, expected-state derivation from base plus
approved facts, actual-state scan, coverage binding, golden vectors) is
defined by **LLP 0165** (proof domains and checkpoints), whose acceptance is
a named prerequisite for the core tier's boundary-proof component. For a materialized checkpoint
the verification is dual-path over **one pinned source snapshot**: the
checkpoint operation pins a source read snapshot that both the backup and an
independent scanner consume, and the two digests must agree — two code
paths, one value. What that proves is **verified copy fidelity at the pinned
snapshot**, not boundary proof in LLP 0081's predecessor-derived sense, and
the profile claims only the former for checkpoints. The pinning mechanism is
net-new work: the landed `MaterializedBase::materialize` gives the *copy*
internal consistency (it reads the version off the copied pages) but holds
no source transaction an independent scanner could share — whether SQLite's
backup API can run inside a held source read transaction, and the WAL-growth
bound of holding it for a database-sized copy, is a named spike. Without
database-wide `AS OF`, a later scan of the live source cannot recover the
copied version, so the snapshot's transaction and WAL lifetime is part of the
checkpoint operation's declared resource budget, and a snapshot that cannot
be held long enough produces a stable refusal, never a digest over drifted
bytes. Checkpoint publication imports LLP 0158's publication state machine
normatively and completely — staging sentinel (so refusal predates the
data), staged pathname, fsync order, atomic rename as the publication
point, directory fsync, orphan recovery by the rename's verdict, and receipt
linearization — so "a crash leaves no checkpoint or a complete verified one"
is a property of that machine, not an assertion, and its acceptance uses
0158's intra-state crash-cut matrix, not boundary sampling. One declared
deviation from the imported machine: checkpoint *validity* after erasure is
registry-authoritative (unlike fork bootability, which 0158 recovers from
local evidence), because erasure obligations need an authority that can
outvote a self-evident copy. A receipt-only checkpoint's
digest is inventory unless the dual-path verification ran at creation. A
checkpoint digest without an independent derivation remains inventory.

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
argument digest alone is not replay-sufficient; the log is a named schema in
the follow-on Spec (artifact identity, canonical arguments, ctx answers,
effect observations, causal dependencies, custody classes). When
non-promotability arises late — an uncovered-lane co-write, a non-retainable
replay input — the branch receipt names the specific operation that
foreclosed promotion with a stable diagnostic, so the agent knows what to
change rather than merely that work is lost.

The landed `branches::promote` path applies overlay post-images directly — a
deviation from Accepted LLP 0097 §5, which already forbids driving promotion
from post-images, not a design this Draft supersedes. The fix belongs to
0097's implementation lane and is ticketed there independently of this RFC's
fate; this profile inherits 0097's rule and adds the negative conformance
fixture proving no product path can reach post-image promotion.

V1 promotion requires the canonical head to equal the fork's recorded base
version, and it consumes a sealed approval artifact: a `PromotionRequestV1`
binds the exact reviewed child-stream head (sealed by a branch-head CAS — a
branch write after review invalidates the request), the operation-log digest,
the diff digest, the coverage manifest, the approver's identity and
authority, and a stable promotion identity — the admission-ticket identity,
server-minted at first admission, invariant across rebase and re-seal, and
governed by the host-originator epoch protocol; it, not any
`childStreamId`-derived value, is the aggregate identity of §1. The approval
binds the **approved-facts digest**, which covers the normalized
decision/result facts, the relevant read dependencies (base-relative), the
retained ctx answers, the write set, the effect set, the artifact identity,
and the coverage manifest — LLP 0097 §5's meaning-preservation comparison,
not the write set alone, so identical post-images over a changed base do not
re-seal. When a rebase re-executes the log and reproduces that digest
against the new head, the request **re-seals automatically** against the new
`childStreamId`: the original approver's approval over the digest is
preserved untouched, and the re-seal is recorded as a separately identified
engine attestation, never as a new approval attributed to the original
signer. Any divergence — including different reads or results with
identical writes — forces fresh approval. Promotion revalidates current
principal, grant, policy, manifest, operation
identity, and fence; re-executes the operation log into staging; compares the
resulting write/effect facts with the request's approved facts; and commits
once, as **one canonical transaction and one canonical version** (LLP 0097's
batch rule), writing one aggregate promotion envelope keyed by the promotion
identity with per-source join records at that version — the aggregate
envelope is the retry receipt. The promotion transaction also durably copies
the replay-sufficient log entries' envelope facts (principal, artifact,
arguments, read/write facts) into canonical alongside the join records, so
per-row attribution survives branch teardown rather than dangling as opaque
identifiers.

A branch whose log contains no egress attempts is promotable under a
`DenyAll` egress policy — denial forecloses promotion only for operations
that attempted effects. An operation that writes to an uncovered lane inside
the fork makes the branch non-promotable: equivalence cannot be proved for
writes the journal does not cover.

If canonical state has advanced, promotion refuses. The paved recovery is
**rebase by replay**: the recorded replay-sufficient operation log is
re-executed into a new fork based on the current head, re-diffed, and
promotion re-attempted; divergent re-execution results surface in the fork
diff for review rather than being auto-resolved, because clean re-execution
is not meaning preservation (LLP 0097 §5). This adds no merge and no
advanced-head semantics — it points the already-specified re-execution at a
new base. Beyond that, the strict protocol deliberately trades convenience
for provability. Advanced-head semantic reconciliation remains a separate
future RFC.

Contention is answered by the engine, not etiquette, because the pinned
first consumer is a fleet of concurrent agents forked from one head.
Promotion admission is **serialized per canonical stream**: attempts are
admitted one at a time in admission order, so of k concurrent forks exactly
one promotes per admission cycle and the rest observe a deterministic
refusal, not a race. Admission is fair, not merely serial: a fork that loses
holds a FIFO admission ticket that its rebased successor inherits, so a slow
or large-log agent is not deterministically outraced by newly arriving
forks, and the rebase budget scales with the observed concurrent-fork count
rather than being a constant chosen blind to k. Exhausting the budget
refuses with a stable contention-exhausted diagnostic that distinguishes
"lost the head again" from "re-execution diverged," and the aggregate
contention rate is an app-level fact the admission queue exposes rather than
a per-principal quota that cannot see it. The progress guarantee is
**conditional fairness with a declared model**, not an unconditional claim:
promotion admission serializes only promotion — ordinary canonical mutations
advance the head outside it — so bounded eventual progress for all k forks
holds when promotion arrival stays below admission service capacity and
replay work per fork is finite, and the engine adds one bounded escalation
to keep the condition reachable: after a ticketed fork loses R consecutive
cycles, its next cycle takes a **bounded head reservation** — ordinary
mutation admission on that stream is deferred for a declared, bounded
interval while the re-sealed promotion commits. Reservations are quotaed per
app and stream (a principal cannot repeatedly defer application traffic by
losing on purpose), a maximum promotion-commit duration is declared, and a
reservation that expires mid-attempt aborts the attempt cleanly with the
ticket retained. Ticket lifetime equals the fork's TTL, which must exceed
the fork's expected service time under the observed queue depth (a declared
condition, not an assumption); the rebase budget is a declared function of
queue position, the reservation threshold R, and observed losses, with the
observed concurrent-fork count as its floor. Under those declared terms,
bounded eventual progress is an
acceptance property; outside them, the contention-exhausted diagnostic is
the honest outcome. The measurement gate's mutation-latency metrics include
p99 under promotion contention so the reservation's cost is measured, not
ambient.

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
(non-promotable) fork. A **receipt-only checkpoint** is a durable boundary
receipt — schema identity, stream-qualified commit version, coverage manifest,
and optional independently verified `ContentDigestV1` — with no retained
state; it supports later proof and audit but cannot materialize the past by
itself. Neither class pins the canonical replay floor: a materialized
checkpoint retains its own copy, not canonical journal history. Migration,
fork, deployment, incident, and explicit agent operations may create
checkpoints, declaring the class. A fork's pinned base is a lighter receipt of
its own materialized copy, not automatically a named checkpoint. (The corpus
uses "checkpoint" in other senses — LLP 0075's protocol checkpoints, LLP
0090's resumable query snapshots, LLP 0081's rehearsal checkpoints, and
`ContentDigestV1`'s own stream-accumulator checkpoints; a named
database checkpoint here is none of those.) A checkpoint is a
read-later/rehearsal primitive, not a promise that every intervening commit
supports relational `AS OF`.

History reads authorize fail-closed under the two-part rule this RFC states
normatively (agreeing with LLP 0088 §6, whose history-tier landing OQ8
tracks): the caller must be authorized for the record **now**, and
the read policy is additionally evaluated against **each historical
post-image**, dropping versions that fail — failing versions are elided, not
disclosed. 0088 explicitly rejected the cheaper current-row-only gate because
it leaks formerly-visible field values; this profile inherits that rejection.
The same per-version rule extends to retained explanation detail and
fork-diff rows, which are historical row values by another name. For
non-row facts **this RFC owns the rule** (LLP 0088 is the analogy, not the
source — its design has no non-row fact categories): the **current** read
policy evaluates each retained fact; no historical policy version is loaded,
because a retained policy series is exactly the historical representation
this profile's non-goals decline. The residual specific to non-row facts is
the missing first gate — there is no current record to be "authorized for
now," so the current table/lane admission gate below stands in per fact
class. The today's-policy-over-yesterday's-facts bound applies to row and
non-row facts alike and is accepted for both; if it proves harmful in
practice it is a revisit trigger, not a silent behavior. Within that
shape, missing-row and predicate facts evaluate against their table and lane
policy; result-membership facts evaluate as the query's own read would; ctx
answers and effect payloads live in protected-lane custody and are redacted
for callers without it; and pagination and horizon markers never disclose
the existence of elided versions or rows. Possession
of a commit, operation, or checkpoint identifier is not authority.
Revoked credentials cannot settle effects or promote a retained fork.

Retention is always bounded; an explicit owner may extend it only through
finite renewable leases with a mandatory maximum duration (LLP 0088's
no-unbounded-option rule), and only independently materialized checkpoint
copies — never history rows — may outlive the history window.
Garbage collection preserves active fork bases, named checkpoint roots, open
operation receipts, and the minimum explanation facts required by policy, then
reclaims expired detail and materialized state. Deletion and erasure
obligations override pins: a protected-lane erasure applies to retained
detail, history post-images, and materialized checkpoints, and the receipt
records the erasure rather than silently keeping the bytes. Materialized
checkpoints participate through custody: every copy is registered at creation
with an owner and location class; erasure marks the checkpoint invalid in the
registry so later use fails closed, destroys reachable copies (or shreds
their keys where copies are encrypted at rest), and records on the receipt
which copies were destroyed versus marked invalid but unreachable. An
unreachable copy is an honest open erasure obligation, not a silent success.

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
- fork capability as orthogonal axes: egress policy (`Missing` | `DenyAll` |
  `CaptureOnly`), promotion (`NotPromotable` | `Promotable` — a `DenyAll`
  branch with no egress attempts may be `Promotable`), base (`currentHead` |
  `namedCheckpoint`; promotion exists only at `currentHead`), and
  host-mediated versus end-to-end isolation. These changes are carried as a
  **dated proposed-normative amendment to LLP 0097** (2026-08-03, effective
  when this RFC is accepted) whose declared scope is every 0097 section it
  touches: §Capability classes (the axis split and the `DenyAll` value),
  §Acceptance (the fixture substitution below), §5's promotion protocol (the
  serialized fair admission, bounded rebase budget, rebase-by-replay, and
  `PromotionRequestV1` additions of this RFC's §5), and the claim boundary
  where it names branch capability values. 0097's ordered `Missing` |
  `CaptureOnly` | `Promotable` maps to (`Missing`, any), (`CaptureOnly`,
  `NotPromotable`), and (`CaptureOnly`, `Promotable`) respectively, so an
  existing three-value report translates losslessly; a (`DenyAll`,
  `Promotable`) target passes 0097's acceptance corpus with the
  effect-settlement fixtures replaced by negative fixtures proving its
  attempt markers are empty and that any egress attempt forecloses
  promotion. That combination is named **`Promotable(noEffects)`** — a
  strictly narrower claim than 0097's `Promotable`, whose staged-settlement
  half it has never exercised — and it must not be reported as 0097's
  `Promotable`: the reverse projection for legacy three-value consumers maps
  it to `Missing`, a deliberate, documented under-claim (projecting to
  `CaptureOnly` was considered and rejected because it would assert a
  capture ledger that does not exist; 0097's honesty rule forbids
  over-claiming, and consumers wanting the truth read the extension);
- diff coverage by data/effect lane;
- history class (`Missing`, bounded changes, named checkpoints);
- proof class (recorded inventory, `verifiedCopyFidelity` for the checkpoint
  dual-path claim, or independent boundary proof — the middle value exists so
  projections cannot upgrade copy fidelity into 0081-sense proof);
- replay class (deterministic handlers versus nondeterministic actions);
- schema-evolution class (proofs with no lens claim); and
- admission/resource-bound class.

These class values are a versioned capability-manifest extension carried
beside LLP 0134's maturity registry, not forced into it: the extension itself
registers as a `TargetCapabilityId` whose maturity (soak, promotion registry,
demotion) is 0134's business, while the multi-valued class facts live in the
extension because `TargetCapabilityId` is a closed boolean-membership enum
that cannot carry them; manifest validation enforces mutual exclusion within
each axis. Capability claims are per-target; whether an app exercises a
claimed capability (history, for example, is per-table schema opt-in) is an
app fact that does not change the target's advertisement.

The v1 aggregate is closed, and it is layered so no tier is hostage to a
document this RFC does not own. **`AgentSafeV1-core`** requires, on the local
target: the ordinary Ibex mutation lane and the host-plan settlement lane
(the latter advertised at `clientSuppliedValidated` provenance while LLP 0007
Option A is unratified), each with envelope coverage and explanation;
**in-app branch** support with a declared egress policy of `DenyAll` or
`CaptureOnly`; branch promotion; exact diff; and boundary proof, where the
boundary proof the core requires is the promotion domain (migration proof is
LLP 0081's, and the checkpoint domain gates the checkpoint capability).
Derived-deployment fork support is **not** in core: it is a separately
advertised additive capability gated on LLP 0158's acceptance, and the
derived-deployment legs of Acceptance 5 and 7 gate that capability rather
than the core tier (the Acceptance preamble's row mapping carries this
carve). The fork-at-checkpoint affordance named by the as-of revisit trigger
therefore applies only where this additive capability is advertised. The core's provenance
rule is that **no core component depends on a decision owned by a document
this RFC does not control** — the promotion proof domain's focused Spec is a
named prerequisite this RFC commissions and controls, which is the one
in-family exception the table shows — stated per component rather than as a
blanket status claim:

| Core component | Owning document | Status | Dependency |
|---|---|---|---|
| Branch substrate, promotion | LLP 0097 (+ dated amendment above) | Accepted, gate unpassed | decided |
| Envelope, diff, explanation | this RFC | Draft | decided here |
| Promotion proof domain | LLP 0165 | Draft | named prerequisite |
| Derived-deployment forks | LLP 0158 | Draft | **not core** — additive capability |

The committed contract details and artifact schemas are owned by the
extracted Specs — LLP 0163 (operation identity and commit envelope), LLP
0164 (fork and promotion), LLP 0165 (proof domains and checkpoints) — under
LLP 0037's generated-schema pattern; this RFC remains the profile umbrella.
| Host-plan lane contract | LLP 0007 | Draft (shipped; Option A unratified) | provenance labeled `clientSuppliedValidated` until ratified |
| Identity/settlement widening | LLP 0133 / 0043 amendments | Spec Accepted / RFC Draft (shipped) | decided contract, dated amendments pending |
| Client conformance | LLP 0012 / 0095 amendments | Draft (shipped) | decided contract, dated amendments pending |
| Read-surface conventions | LLP 0004 (+0017/0024/0042) | Draft (shipped conventions) | shape only |
| Scoped grants | LLP 0055 | Review (shipped) | decided contract |
| Effect vocabulary | LLP 0066 | Review, unowned taxonomy | classification labels only |

**This RFC owns the per-version authorization rule for retained
explanation detail and fork-diff rows in the core tier** — §6 states the
two-gate rule normatively here rather than importing it, and OQ8's
supersession question applies only to the history tier.
**`AgentSafeV1-history`** is
an additive tier gated on LLP 0088's acceptance, adding bounded record
history and its authorization corpus. Uncovered *specialized* lanes do not
block the core aggregate — core certifies its enumerated ordinary lanes
while those absences stay visibly advertised as `Missing`. Receipt-only
checkpoints without dual-path verification are a separately named
inventory-only capability and join no aggregate. Conformance is two separate facts:
*target support* (the machinery exists and passed acceptance) and
*app-effective coverage* (the projection of covered lanes, opted-in history
tables, and retained classes this app actually has); the unqualified
aggregate claim requires both, and agents plan against the app-effective
projection. Specialized lanes (migration, durable background work, push,
auth) advertise individually and join the aggregate only through OQ7's
receipt bridge. If any component demotes under LLP 0134's rules, every tier
containing it demotes with it. A target with a missing component advertises
the individual capabilities it actually has.

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
  full-table scan and no per-row Merkle-ancestor update. Bounded per-record
  history additionally requires a `(table, row, version)` journal index —
  per-row write amplification — and the explanation enumeration surface (§2)
  requires a principal/time index on envelopes — per-operation amplification;
  the two costs are measured separately in the bytes-written metric, named
  here, not silently absorbed.
- Full content digest computation, checkpoint copying, and historical
  materialization are explicit operations with progress and resource budgets.
- Fork and retention garbage collection are demand-driven or bounded; they do
  not introduce idle polling or periodic writes on an idle local app.
- Explanation payloads and effect observations are size-bounded and redact or
  refuse secrets rather than turning provenance into an unbounded data lake.

### Measurement gate

Each metric gates the component it measures — read/write/idle metrics gate
the envelope and explanation components; fork, diff, promotion, and reap
metrics gate the fork and promotion components; the full list gates only the
aggregate — so early sequencing steps can advertise their components without
waiting for promotion to exist. Before a component may be advertised above
`Missing` (the claim boundary in §Summary), the same fixture corpus and
protocol must compare the dated named baseline artifact against the
profile-bearing build for:

- current-state point/range/query-plan reads;
- warm-VM single-writer mutation throughput and p50/p95 latency;
- fan-out cost for the existing local benchmark shapes;
- bytes written and retained per changed logical row and per operation;
- idle CPU, resident memory, and disk writes;
- fork creation, diff, promotion, and TTL-reap latency at representative data
  sizes; and
- crash/reopen behavior at every envelope, publication, promotion, and effect
  settlement cut.

The comparison baseline is a dated, named baseline artifact, not a runtime
toggle: the profile defines no supported profile-off mode, so profile-off
numbers come from the pre-profile baseline binary re-measured under the same
protocol. LLP 0035's current numbers are explicitly single-run
order-of-magnitude evidence, so a statistically controlled baseline must be
recorded before this gate can run: fixed hardware class and fixture sizes,
declared warm-up, a declared run count, median plus spread, and per-metric
equivalence bounds with explicit formulas for throughput and latency
regression. The guardrail is normative, not proposed: no read-path
regression beyond the equivalence bound, no new idle CPU or disk writes, and
no more than a 15% regression in warm single-writer throughput and in
mutation latency (p50 and p95, each judged individually). The revision and
exception authority is **the author, by dated revision to this RFC** — LLP
0130's standing decisions do not currently cover this document, and claiming
them would require a new SD there, which is not asserted. Exceptions are
bounded, not open-ended: no exception may pass a metric beyond twice its
threshold; an excepted metric is re-measured after the next component lands;
and an exception holds the affected capability below `Stable` under LLP
0134's maturity rules until it re-measures within threshold. Every exception
is ratified before capability promotion, names a documented benefit, and is
recorded next to the baseline artifact, never silently absorbed. Acceptance
13's pass condition is the thresholds in force
in this section at measurement time. Creating the baseline artifact is
sequencing step 0. The fork/diff latency metric doubles as the instrument for
the Merkle revisit trigger's first condition.

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
  authority: envelope-recorded authority identifiers may be used only as
  lookup keys into current authority state — no envelope field may supply an
  authorization *result*.
- Digests over low-entropy arguments or identities are domain-separated and,
  where exposure would create an offline guessing oracle, keyed.
- Quotas cover live forks, retained bytes, history pins, digest work, effect
  captures, and explanation detail; exhaustion produces stable diagnostics and
  never degrades into an unbounded best effort.

## Acceptance

The full profile claim requires all of the following on the local reference
target; each tier advertises when its own rows pass — rows 1–4, 13, and 14
gate the envelope/explanation components, rows 5–10 the fork and promotion
components (with the derived-deployment legs of rows 5 and 7 gating the
additive derived-deployment capability, not core, per §8), row 12 the
boundary-proof component (together, the core tier);
row 11's record-history half gates the history tier and its checkpoint half
the checkpoint capability. Row 13's applicable submetrics gate every
component and tier individually; the complete metric set gates only the
aggregate:

1. **Atomic envelope:** crash cuts around a covered mutation reveal either no
   data/journal/envelope/receipt change or the complete committed set.
2. **Retry settlement:** identical retries return the stored receipt without a
   second write — including a host-initiated retry after a crash; identity
   reuse with any divergence in the bound identity facts refuses stably,
   including reuse under a divergent audience or principal; an in-flight
   first attempt under an open lower epoch is admitted normally while a
   genuinely reclaimed identity refuses; a restored client store, a
   torn-down-and-recreated branch, and a restamped old identity each produce
   the declared outcome rather than a silent duplicate; an identity minted
   before issuer termination but first delivered after floor advancement is
   classified outcome-unknown, never terminal `failed`; crash cuts around
   range preallocation and client range persistence preserve exactly-once; a
   retry answered from a surviving compact envelope receives the stable
   `result-expired` outcome-known disposition; the epoch-closure predicate
   cannot advance a floor past a live unacknowledged receipt; with two
   identities in one open epoch, reclaiming the acknowledged one leaves a
   tombstone so its retry answers `result-expired` rather than executing as
   novel; an offline client that exhausts its preallocated range degrades to
   the disclosed uncovered queueing disposition; receipt-only
   operations sharing one snapshot version keep distinct
   envelopes keyed by operation identity; and after every envelope and
   suppression record for an identity has been reclaimed, a retry bearing a
   below-floor epoch still refuses with `identity-horizon-passed` rather than
   re-executing.
3. **Provenance and explanation:** a committed row change joins to its
   operation, principal, authority, artifact, and retained read/write facts —
   at a promotion version, through the write-fact-granularity per-source join
   records to the originating branch operation;
   expired detail reports `detail-expired`, capture-bounded detail reports
   `detail-truncated`, a surviving envelope whose journaled rows were pruned
   reports `journal-expired`, and none fabricates an empty explanation;
   bounded enumeration by principal/session/time authorizes fail-closed;
   an aggregate whose constituent authorization cannot be evaluated after
   expiry or truncation returns `authorization-unprovable` under changed
   grants rather than disclosing counts or digests; non-row
   explanation facts (missing-row, predicate, membership, ctx answers,
   effects) authorize fail-closed per their fact class under changing
   principals and grants.
4. **Coverage honesty:** every declared lane has positive and bypass fixtures;
   an undeclared or unjournaled lane cannot produce a complete diff/proof
   claim; and manifest fixtures compare target support with app-effective
   coverage, proving missing specialized lanes remain visibly missing.
5. **Fork isolation:** proved per class — in-app branch writes over the
   materialized base plus overlay are invisible to canonical and sibling
   branches, and derived-deployment fork isolation is proved under its own
   declared model; canonical writes after the base are invisible to the
   materialized base in both classes.
6. **Effect quarantine:** every host egress family is denied or, where the
   class declares capture, captured in the fork, with negative bypass tests;
   the `DenyAll` attempt marker survives branch crash and reopen;
   client-side scope is reported separately.
7. **Identity and authority:** proved per class — canonical credentials are
   absent from a derived-deployment fork, while an in-app branch proves
   canonical-capability non-reachability under branch-scoped authority no
   broader than its creator's; revoked or stale authority blocks promotion
   and later effect settlement in both classes.
8. **Resource containment:** count, byte, digest, and TTL limits refuse or
   reap deterministically; after any reap or expiry the canonical replay floor
   equals its value as computed from sync-resume retention alone (LLP 0088
   §5's independent clocks), and the envelope-identity window neither pins
   the floor nor lets a journal row outlive its envelope.
9. **Exact fork diff:** randomized covered writes compare the journal-derived
   net diff with an independent base/head logical comparison, including
   deletions, missing rows, update-then-revert and delete-then-reinsert
   folding (distinguished via retained preimages or the immutable base),
   schema/system coverage, and multiple commits; the attributed change
   sequence is verified separately against the journal.
10. **Strict promotion:** an unchanged-base branch re-executes into staging
    and commits once; any advanced canonical head refuses; contingent effect
    state remains provisional through settlement, including LLP 0097's
    transitive fixture where a chain of operations dependent on a provisional
    effect outcome stays provisional together; no product path can invoke
    the deviating post-image promotion; promoting a branch whose operations
    carry branch-local envelopes re-executes rather than returning a stored
    branch receipt, and a post-promotion retry of the canonical identity
    returns the canonical receipt; rebase-by-replay into a fresh fork
    re-executes the recorded log and surfaces divergent results in the diff;
    and k concurrent forks of one head resolve through serialized admission —
    one promotes per cycle, the rest observe deterministic refusals, and an
    exhausted rebase budget yields the stable contention-exhausted
    diagnostic; under the declared conditional-fairness terms — with
    approval issuance in the loop and concurrent ordinary canonical writers
    running — all k forks make bounded eventual progress via inherited FIFO
    tickets and the bounded head reservation; promotion consumes only a
    sealed `PromotionRequestV1` — a branch write after review invalidates
    it, and a rebase that reproduces the full approved-facts digest re-seals
    without fresh approval as an engine attestation over the preserved
    original approval — while identical writes over a changed base, or
    divergent reads or results with identical writes, refuse re-seal and
    force fresh approval (negative fixtures for both); a retry of the
    pre-rebase aggregate identity returns the aggregate receipt.
11. **Bounded history and checkpoint:** retained row changes and named
    checkpoint receipts survive crash/reopen and expire or remain pinned
    according to policy; authorization enforces the per-version rule — a row
    whose visibility changed between retained versions returns the authorized
    versions and elides the rest without disclosing their existence, including
    across pagination and horizon markers; erasing a protected record
    destroys or invalidates every registered checkpoint copy and records
    unreachable copies as open obligations.
12. **Boundary proof:** migration/promotion/checkpoint fixtures independently
    derive expected values and compare them with actual `ContentDigestV1`
    under each boundary's domain-separated preimage (§4); checkpoint fixtures
    run with concurrent writers before, during, and after the backup and
    prove same-snapshot equality or a stable refusal; checkpoint publication
    crash cuts land on either side of the atomic rename per the imported
    LLP 0158 state machine, never in between; inventory-only
    digests cannot be presented as proof.
13. **Performance budget:** the measurement gate above is published against
    the named baseline artifact and passes per metric; any exception names its
    documented benefit next to the baseline before capability promotion.
14. **Identity lifecycle:** capacity exhaustion refuses admission rather than
    evicting receipts; unacknowledged receipts are never reclaimed; delayed
    acknowledgements and crash cuts preserve exactly-once; operator purge is
    explicit and recorded as forfeiting exactly-once; a below-floor retry is
    presented to the client as outcome-unknown, never a terminal `failed`;
    a negative fixture proves no authorization decision can be derived
    from envelope contents beyond lookup-key use into current authority
    state; and a client-minted identity cannot occupy the host-derived
    namespace — a squatting attempt neither forecloses nor perturbs the
    later host-derived operation.

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

0. Record the dated, statistically controlled performance baseline artifact
   (§Measurement gate) — it blocks every component's advertisement.
1. Make `operationId` automatic on first-party ordinary mutations and unify
   their duplicate-suppression/receipt behavior with the existing settlement
   vocabulary.
2. Add the operation-level provenance record and public explanation surface
   over existing captured read/write facts, with the read API shaped by LLP
   0004's surface conventions (admin/inspection per LLP 0017; agent surfaces
   per LLP 0024/0042).
3. Wire the fork substrate per class: (a) the in-app branch — registry/TTL,
   branch-scoped grants, resource bounds (egress mediation is step 5(a); a
   3(a) branch cannot execute egress-bearing paths until it lands); (b) the derived
   deployment — identity scrub-and-mint, publication recovery, registry/TTL,
   coordinated with LLP 0158's F0a program. Step 6's promotion consumes (a)
   only.
4. Record fork operations with the envelope and expose the exact coverage-aware
   journal diff.
5. Wire LLP 0097's host-egress mediation in two slices: (a) the `DenyAll`
   mediation slice — a genuine prerequisite for any in-app branch; (b) the
   capture-ledger slice, needed only for `CaptureOnly` and for promoting
   branches that attempted effects. Step 6 consumes (a); no-egress branches
   promote without waiting for (b).
6. Wire strict-CAS staged promotion by re-execution over a replay-sufficient
   operation log, with serialized admission and the bounded rebase budget,
   including provisional effect state and fenced settlement,
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

1. What are the default detail-history, envelope-identity, and
   named-checkpoint retention windows, and which principals may extend them
   within the finite-lease rule?
2. *(Decided in v0.5: host-plan coverage stays mandatory in the core
   aggregate, advertised at `clientSuppliedValidated` provenance while LLP
   0007 Option A is unratified.)* Does Option A's eventual ratification
   change the advertised provenance class in place, or mint a new manifest
   version?
3. Which read/write explanation details remain stored verbatim, which are
   canonical digests only, and which require protected-lane custody?
4. Does the normative 15% local mutation budget match the workload value?
   The author may ratify a different threshold by dated revision to this RFC
   (the §Measurement gate's authority — LLP 0130 does not cover this
   document) before the sequencing step 0 baseline lands; the read-path
   equivalence bound and idle tolerances are pre-registered numerically in
   the step 0 protocol, and the initial instrumentation-only measurement is
   gated on that same baseline artifact.
5. Which document owns the committed artifact schemas and capability-manifest
   extension: this RFC after acceptance, LLP 0037's generated-schema pattern,
   or a focused follow-on Spec — and how do the §8 `TargetCapabilityId`
   registrations interact with LLP 0134's soak windows? The same owner takes
   the disposition vocabulary (`detail-expired`, `detail-truncated`, horizon
   markers, `identity-horizon-passed`) and the aggregate definition, so both
   can version independently of this RFC.
6. Is LLP 0007's Option A host-plan contract ratified before the P5
   explanation surface ships, or does making that lane's provenance public
   force the ratification?
7. Which existing specialized receipts can map losslessly into the universal
   envelope, and which need an explicit compatibility/version bridge?
8. When LLP 0088's 0085-gated evidence review lands, does its history design
   supersede §6's import verbatim for the history tier? (The core tier's
   per-version rule for explanation detail and fork-diff rows is owned by
   this RFC per §8 and is not at stake.)
9. Do derived deployments inherit the parent's historical envelopes and
   explanations, or only application state plus fork-local provenance minted
   after the cut?
10. *(Folded into §8's dated LLP 0097 amendment in v0.6, which now names
    §5's protocol additions including rebase-by-replay.)* Does divergence
    surfacing need its own receipt vocabulary?
11. *(Decided 2026-08-03 at acceptance: yes — an agent principal holding an
    LLP 0055 scoped grant may be the `PromotionRequestV1` approver; the
    approval records the grant identity, and Acceptance 10's fairness
    fixture may run with an agent approver in the loop.)*
12. Does the core tier need a "list my live forks and their promotability
    disposition" surface — §2's enumeration reasoning applies to fork
    receipts too?
13. The snapshot-pinning spike (§4): can SQLite's backup API run inside a
    held source read transaction without restart, and what is the WAL-growth
    bound for a database-sized copy?
14. *(Executed 2026-08-03 at acceptance: the contracts are extracted to
    LLP 0163 — operation identity and commit envelope, LLP 0164 — fork and
    promotion, and LLP 0165 — proof domains and checkpoints (the promotion
    proof Spec §4 names), each Draft, each owning its committed artifact
    schemas under LLP 0037's generated-schema pattern, which also settles
    OQ5's ownership half; this RFC remains the profile umbrella and the
    acceptance corpus's home.)*

## Status

**Accepted** (2026-08-03, Charlie), after the seven-round dual-family
super-refine loop recorded in
`llp/reviews/0162-agent-safe-storage-profile.super-refine.md`; the v0.8
repairs entered acceptance unreviewed under the loop's declared stopping
rule, with both round-7 reviews prescribing at most a scoped re-read.
Acceptance changes document status only: per the §Summary claim boundary,
every capability remains `Missing` until the acceptance corpus passes on a
target, and the sequencing step-0 baseline artifact, the OQ13
snapshot-pinning spike, and the extracted Specs' (LLP 0163-0165) own
acceptance gate advertisement. This RFC neither changes the current
canonical local target nor claims that the profile ships, and it is not a
commission to implement — LLP 0130/0129/0155 own commissioning.
