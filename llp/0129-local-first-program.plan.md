# LLP 0129: The local-first program

**Type:** Plan
**Status:** Accepted
**Systems:** Sync, Storage, Runtime, Client integration, Auth, Wire Protocol, Realtime, Packaging, Testing, Documentation, Competitive evaluation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-07-31 (standing-decisions pointer: LLP 0130 records
the author's pre-adjudicated conditional rules for this program's
mid-flight gates — SD-3 folds the offline dimension into the shared
successor rerun, answering §Measurement's pending composition; SD-5
makes the phase gates self-advancing on gate success; ER-1 reserves
option-C admission as the author's call alone.)
2026-07-31 (v0.3, lockstep round-1 fixes: round 1 of the
{0115 v0.6, 0129 v0.2} lockstep super-refine returned Fable READY /
Codex NOT READY for this Plan (artifacts
`reviews/0115-0129-lockstep.fable.md`,
`reviews/0115-0129-lockstep.codex.md`). Codex blocking 1: v0.2's "one
rerun serves both programs" silently decided rerun composition, which
is LLP 0115 open question 4's still-open adjudication — §Measurement
and §Cross-gates now carry the fold as this Plan's proposal pending
OQ4, with the program's diary-grade offline acceptance and
measurement independently mandatory either way. Codex blocking 2:
§Exit criteria gains the program-completion boundary — criteria 1–2
are Phase 0's exit and Phase 0's exit is not program completion;
criterion 3 binds same-code claims from Phase 1 on; criterion 4 binds
every phase; "program complete" is defined over all authorized
phases (0, 1, 2a, 2b) plus a stated disposition for the Option F
rider. Codex material 3 + Fable material 1 (same territory): ledger
row 1 gains decision 10's domain and lane scoping —
application-visible values vs. the protocol-lane `clientMutationId`,
verified against LLP 0008 §Replay environment contract on
2026-07-31: 0008's replay-accept pin (the wire transmits
`{generatedIds, now}`; the server accepts them on replay) STANDS for
the queued-intent replay lane Phase 0 ships, while the settlement
Spec governs the local-execution lanes, where re-derivation is the
stricter default; any future change to the 0008 pin lands as a dated
0008 amendment. Detail fixes: criterion 3's ledger gate restated as
all five unowned designs with row 1 merely first (Codex detail 4);
criterion 2's arm-scoped guide rows named as a Phase 0 deliverable —
`guide/capabilities.md` is arm-agnostic today (Fable D1);
LLP 0084/0107/0108/0118 added to Related (Fable D2); the decision
registry cited as "LLP 0115 open question 8" by question, not
version (Fable D3). Per the LLP 0063-style delegation, this revision
was agent-executed under the author's 2026-07-31 direction.)
2026-07-30 (v0.2, decisions recorded: 0127 decisions 2
and 10 were adjudicated by the author on 2026-07-30 — decision 2
confirms this Plan's shape and authority, the JS/React browser arm as
first carrier, and the two-parallel-ladder staging with IR-rung-first
resourcing, with option C not admitted and held behind a named trigger
(open question 4 records the wording verbatim); decision 10 sets
server re-derivation as the settle-time default, client-captured
values carried in receipts as labeled claims, bounded-skew only as
per-field declared opt-in, owned by a new settlement Spec under this
program — the program's first owned-Spec deliverable. §Decision
posture updated: the phases are authorized to start; open questions
1–2 are decided and question 3 is moot; the LLP 0115 cross-references
now cite its landed v0.6, whose open question 8 is the decision
registry of record.) 2026-07-30 (initial draft, directed by the author
the day LLP 0127 was Accepted; drafted with 0127's open decisions 2
and 10 deliberately unmade — see §Decision posture)
**Related:** LLP 0003, LLP 0008, LLP 0012, LLP 0013, LLP 0034, LLP 0043, LLP 0051, LLP 0053, LLP 0059, LLP 0070, LLP 0073, LLP 0074, LLP 0080, LLP 0081, LLP 0084, LLP 0090, LLP 0093, LLP 0107, LLP 0108, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0114, LLP 0115, LLP 0116, LLP 0118, LLP 0119, LLP 0123, LLP 0125, LLP 0126, LLP 0127, LLP 0130

## Summary

This is the successor Plan that LLP 0127 §Sequencing 5 proposes for the
local-first program: "a successor Plan, not a 0115 tranche," with its
own sequencing document under 0126 OQ7's answer, cross-gated with
LLP 0115 where the substrate is shared. It executes the analysis of
LLP 0126 (Active, v0.4) as staged by LLP 0127 move 3's
displaced-in-space half. The deferred-in-time half — slice 3-jobs,
transactional one-off scheduling — is **not** this program; it rides
LLP 0070 under 0115's CV-9 and is out of scope here.

Why now, on the record:

- **The diaries scored offline as decisive and the rerun measured none
  of it.** Diaries 0027–0029 recorded offline GAPs as a primary reason
  not to choose Snapback, and recorded the same cold-boot GAP for
  Convex: a reopened browser with the backend down "yielded no
  authenticated application shell and zero retained query rows"
  (Diary 0027, quoted in LLP 0126). Diary 0039's rerun scope excluded
  the territory, so the 55/45 score contains no local-first signal.
  Against Convex this front is an opportunity claim against recorded
  absence; the diaries' measured bar is Firebase and InstantDB
  (LLP 0126 finding 1).
- **The shipped slice is unwired to the scored arm.** LLP 0043's
  retention/replay slice is implemented on the Contract arm (guide
  rows `sync.offline` and `auth.authorized-leases` shipped on the
  local target; local manifest claims `offline_retention` and
  `optimistic_replay`) while the browser JS/React arm the diaries
  actually score has none of it — execution lag and arm coverage, not
  design absence (LLP 0126 finding 3; LLP 0116 finding 2).
- **The field retreated toward Snapback's posture.** Two dated
  first-party retreats from CRDT cores (Electric 2024, Jazz 2026),
  Ditto's read-time-derivation guidance, and LLP 0084's five-to-zero
  materialized-state count corroborate server authority, tentative
  client writes, and state-delta delivery — LLP 0008's pin — without
  any surveyed peer holding Snapback's distinctive ingredient set for
  same-code-both-sides re-execution (LLP 0126 findings 2 and 5).

What the program delivers, its staging now confirmed (0127 decision 2,
2026-07-30), if its exit criteria hold: a scored browser arm that beats
Convex's measured
cold-boot GAP for the retainable subset; the JS/React arm carrying the
same retention/replay claims the Contract arm already proves; and a
tested path toward LLP 0051 §D6's "Parity by construction" — with
every claim scaled to exactly what its acceptance proves.

## Decision posture

LLP 0127 is Accepted, and the two of its routed author decisions that
bear directly on this Plan were adjudicated by the author on
2026-07-30 (registry of record: LLP 0115, open question 8 — cited by
question, durable across that Plan's revisions). Both are
**decided**; §Open questions 1–2 record them:

- **0127 decision 2 — DECIDED.** The successor-Plan shape (this
  document) is confirmed as the program's authority; the JS/React
  browser arm is the first carrier; the two-parallel-ladder staging
  with IR-rung-first resourcing is confirmed (0126 OQ1/OQ7). Option C
  (client mutators) is NOT admitted; it is held behind a named
  trigger — admit only if the IR rung proves insufficient for
  browser-side write expressiveness after measurement (§Open
  questions 4 records the wording).
- **0127 decision 10 — DECIDED.** Server re-derivation is the default
  for client-captured `now`/ids at settlement; client-captured values
  are carried in receipts as labeled claims, never authority;
  bounded-skew acceptance only as a per-field declared opt-in
  (0126 OQ3). The policy is owned by a new settlement Spec under this
  program — the program's first owned-Spec deliverable (ledger
  row 1).

Consequences, stated plainly: this Plan's phases are authorized to
start under its authority, and §Phases is the program's staging
rather than a proposal. What was drafted to hold under any resolution
now binds: Phase 0's arm is the JS/React browser arm; ledger row 1's
owner is the settlement Spec, which gates every
`Parity`-by-construction claim until it lands (0127 records item 10
joining move 3's displaced-in-space exit); exit criteria 1 and 3 bind
as §Exit criteria states. Per-phase owners and timeboxes (§Open
questions 5) remain the outstanding before-start requirement for each
phase. Under LLP 0130 SD-5 (2026-07-31), the phase gates are
self-advancing: a phase whose named gate passes advances without
fresh adjudication; gate failure or scope change escalates to the
author.

## Governing constraints

Constraints 1–2 are inherited verbatim in force from LLP 0115
§Governing constraints; 3–7 are this program's own.

1. **No evidence regression.** A work item that improves ergonomics by
   weakening an evidence boundary is out of scope. The options 0126
   marked as boundary-erasing (raw client SQL replicas, unbounded
   caches, CRDT core) are rejected by 0127 §What this deliberately
   does not do and stay rejected here.
2. **Honest capability claims only.** LLP 0012's rule governs: no
   local execution means no local-first/parity claim (quoted by
   LLP 0043, whose proof rule — `Parity` only when every required
   proof is present — is this program's claim gate).
3. **Server-derived authority is not surrendered offline.** Settlement
   is authoritative server re-execution; a locally produced result is
   speculative and never presented as settlement; claims that depend
   on trusted time or server-minted identity degrade per the
   settle-time policy (decision 10, decided: server re-derivation
   default, owned by the settlement Spec) or are excluded from
   the locally executable set. Authoritative settlement, revocation
   delivery, global uniqueness, and trusted timestamps stay impossible
   offline (LLP 0126 approach 9, "What stays impossible").
4. **The ephemeral lane does not sync.** Presence is
   connection-scoped by definition; the pins stand (LLP 0107/0111),
   and 0127 proposes making it a named contract line via an LLP 0013
   amendment (0126 OQ8) — a proposal this Plan carries, not a decided
   change. Every phase below applies to the durable lane only.
5. **Claims scale with the execution-identity tuple's proven
   elements.** The tuple (LLP 0126 approach 9): (1) source/plan
   identity, (2) runtime/evaluator identity, (3) deterministic-tier
   semantics, (4) the host-call answer surface, (5) store semantics
   and schema epoch. Only element 1 is shipped in checkable form (the
   LLP 0118 implementation hash). A claim may assert exactly the
   elements its harness proves; "same code both sides" stays a
   testable hypothesis until the whole tuple is proven.
6. **Browser and desktop ladders stay independent.** Nothing on the
   desktop ladder waits on WASM; nothing on the browser ladder waits
   on the sidecar or the embedding ABI (LLP 0126 v0.4's restaging,
   preserved by 0127 move 3). A design that pretends one lane covers
   both platforms is wrong on day one.
7. **Owning documents stay owners.** This Plan owns program state —
   staging, the ledger, exit criteria, its open questions.
   Substantive design lands in the owners named per phase and per
   ledger row (or a new owned Spec), never here.

## Phases

Staging from LLP 0126/0127, confirmed by 0127 decision 2
(2026-07-30); the previously decision-gated markers are resolved in
place. The phase numbers order the resourcing (the confirmed
IR-rung-first staging puts Phase 1 before either ladder continues);
they are not a strict dependency chain beyond the gates named. Per
LLP 0130 SD-5, phases advance automatically when their named gates
pass; gate failure or scope change escalates.

**Phase 0 — Option A cache hardening on the first arm.** *Arm decided
(0127 decision 2): the JS/React browser arm, the
arm the diaries score and LLP 0074 names as the graduation path.*
Absorb the shipped LLP 0043 lanes into the scored arm: persist the
client cache by default via the shipped `rqsStore` seam; wire the
opt-in resume stores (LLP 0090's token path) into `@snapback/client`
and the LLP 0114 hooks; wire M1 leases and the M2 outbox; mint
`clientMutationId` client-side against the existing settlement
ledger; carry the retention/replay `Parity` claims under LLP 0043's
proof rule. Reach is bounded by design: protected opaque queries stay
non-retainable under LLP 0053's retainability invariant ("Retainable
⇒ declared authorization dependence ⇒ enumerated events"), so cold
retention comes to the declared/analyzable subset. The version-based
delta-resume consumer (designed in LLP 0008, unbuilt) is a named
prerequisite of this lane's minimum wire surface — LLP 0008/0090/0093
territory no rung skips. Owners: LLP 0043/0114/0090, wire in
0008/0093. *Evidence gate:* a diary-grade offline acceptance rerun on
the chosen arm (0126 option A's gate).

**Phase 1 — The shared IR rung.** *Staging confirmed by decision 2;
IR-rung-first resourcing puts this phase before either ladder
continues.* The LLP 0051 D2 mutation-IR evaluator as the local
execution tier — browser-safe, already designed, deriving optimistic
overlays from host plans and earning honest `Parity` for IR-complete
surfaces under the rule LLP 0043 already enforces. Its determinism
conformance gate is LLP 0051 D5's corpus (replay cases, IR profile
cases, enumerated rejections, one shared data-tier version); no IR
`Parity` claim ships before the evaluator passes it. `Parity`-by-
construction claims additionally gate on the owner-landing ledger —
decision 10's decided policy, landing as the settlement Spec, is the
first design this phase's claims hit.
Owners: LLP 0051 (IR, ctx ledger, conformance), LLP 0043 (claim
rule). *Evidence gate:* the IR-evaluator sizing spike (0126 finding
11: nothing is measured) plus the D5 corpus passing on both sides.

**Phase 2a — Browser ladder.** WASM handler artifacts (LLP 0051 D3)
for logic past the IR; full-runtime WASM only behind its named
assessment (0126 OQ5 — size, performance, feasibility are unassessed;
LLP 0051 §Rejected refuses shipping a JS engine to clients for
Parity). Store side rides the proven wa-sqlite/IndexedDB lane
(LLP 0008 DK-9). *Evidence gate:* the WASM assessment, dated, before
the browser story is pinned.

**Phase 2b — Desktop ladder (independent of 2a).** First the sidecar:
the packaged native runtime spawned next to the app, carrying
0127 move 5's sealed, attested artifact (LLP 0123) — process
lifecycle, IPC, port custody, and updater-driven swap against a
client-custodied outbox (exactly LLP 0081's quarantine seam) are the
named costs. Then in-process embedding behind a stable ABI that does
not exist today, behind its own spike. *Evidence gate:* a working
sidecar behind an acceptance suite; the in-process spike before any
embedding claim.

**Mobile — after the OQ10 spike, not a phase.** Hermes is proven on
mobile as React Native's engine, but the Rust host, suspension,
store-policy fit, battery budget, and at-rest custody are unassessed.
A dated spike with named success criteria precedes any mobile
plausibility claim; until it runs, mobile is a question, not a lane
(0126 OQ10).

**Option F rider — explicit-sync backup/export/restore.** Carried
where 0127 §Sequencing 5 put it: a proposed cheap rider on this Plan,
packaging properties that are already true (a locally run Snapback is
a full-authority local app), evidence-positive and foreclosing
nothing. "Near-zero" stays a hypothesis until the surface is sized
(0126 option F). It is single-authority, never marketed as sync.
*Evidence gate:* a paved backup/restore walkthrough proven by an
acceptance script.

Option C (Replicache-class app-authored client mutators) is **not a
phase**, and decision 2 (2026-07-30) decided its posture: option C is
NOT admitted — same-by-convention dual implementations are the drift
the content address exists to remove — and it is held behind a named
trigger: admit only if the IR rung proves insufficient for
browser-side write expressiveness after measurement. This Plan
schedules nothing for it; §Open questions 4 records the trigger
wording.

## The owner-landing ledger

LLP 0126 approach 9 names five unowned designs; 0127 move 3 binds
them to the program's exit: **no `Parity`-by-construction claim ships
before each design lands in an owning document.** The ledger below
carries those five plus two program prerequisites that are owned or
designed but unbuilt. Proposed owners are proposals (constraint 7).

1. **Settle-time trust policy** for client-captured `now`/ids under
   local execution (0126 OQ3 posed accept/clamp/flag). **DECIDED
   (v0.2, 0127 decision 10):** server re-derivation is the default at
   settlement; client-captured values are carried in receipts as
   labeled claims, never authority; bounded-skew acceptance only as a
   per-field declared opt-in. Owner: a **new settlement Spec** under
   this program — of 0126 OQ3's candidate owners, the
   new-owned-Spec branch — and the program's first owned-Spec
   deliverable. Still first among these: the first design the program
   hits once Phase 0 lands; the row un-gates when the Spec lands.
   **Domain and lane scoping (v0.3; verified against LLP 0008
   §Replay environment contract, 2026-07-31).** (a) Decision 10
   governs *application-visible* values: client-captured time and
   ids that enter durable application state — the `generatedIds`/
   `now` class of LLP 0008's replay environment. (b) The
   client-minted `clientMutationId` Phase 0 requires is a
   *protocol-lane* idempotency/correlation key, not an application
   value; decision 10 does not govern it, and there is no collision
   with Phase 0's minting. The settlement Spec pins the two domains
   separately. (c) Lane scoping: LLP 0008's shipped pin — the wire
   transmits `{generatedIds, now}` and the server accepts them on
   replay, because "divergent ids or timestamps between the
   optimistic run and the server run would corrupt data" — **stands
   for its lane**. Phase 0's M2 queued-intent replay lane ships
   under the shipped 0008 accept pin; the settlement Spec governs
   the local-execution lanes (Phase 1 on), where re-derivation is
   the default — stricter than accept, so no boundary weakens under
   either policy. Two lanes, two policies, both labeled in receipts;
   if the settlement Spec ever proposes revisiting 0008's pin, that
   change lands as a dated LLP 0008 amendment, named there.
2. **Partial-replica read satisfiability.** A handler is locally
   executable only if its reads are provably satisfiable from the
   retained subset; table-granular JS-tier declarations cannot prove
   it. 0127 move 6 proposes the bounded-profile grammar
   (LLP 0080/0110) as the admission artifact — 0127's answer to 0126
   OQ4, which poses it as a question; the design pass lands in the
   move 6 owners.
3. **Schema-at-capture versus schema-at-settle skew.** A mutation
   executed locally against schema S1 and settled after migration to
   S2; the content hash does not name a schema era (tuple element 5
   exists precisely because of this). LLP 0081 — owner of the shipped
   quarantine/resync-before-replay seam for queued intent — is 0127's
   *proposed* home for the capture policy, explicitly proposed, not
   settled.
4. **Speculative/settlement receipt shapes.** Speculative receipts
   carry content address plus captured environment; settlement
   receipts bind them to the authoritative commit version (receipts
   already carry `snapshotVersion`); a locally executed result is
   never presented as settlement. Proposed owners: LLP 0043/0034/0093.
5. **The execution-identity tuple itself** as an owned, versioned
   artifact. Proposed owners: LLP 0051 for the semantics elements
   (D5's conformance-corpus version pins element 3; D1's ctx-answer
   ledger is element 4's channel), with LLP 0123's binary+Hermes
   digest attestation seeding element 2.
6. **Revocation-while-offline under the lease bound** (owned;
   inherited, listed to keep the inheritance visible). The shipped
   contract is the strictest surveyed: server-MACed `AuthorizedLease`,
   24-hour hard maximum, equality-is-expiry, deletion-before-render,
   renewal only by fresh full revalidation (LLP 0043 M1; LLP 0053
   §The lease, including the ENG-24992 verification-locus amendment —
   the client trusts retained server-issued facts and cannot verify
   the MAC offline). Fail-closed disconnected means retained data
   expires to deletion; the local-execution lane inherits this
   contract unchanged and must not widen it. What lands: dated
   confirmations in 0043/0053 that locally executed results render
   only under lease-valid retained state.
7. **The version-based delta-resume consumer** (designed in LLP 0008
   §Retention and Resume, unbuilt — the journal floor and
   `resume_requires_resnapshot` have no client caller). A prerequisite
   of every rung's wire surface; owners LLP 0008/0090/0093. LLP 0090's
   outbox rule stands: a non-empty outbox never resumes — full resync,
   then replay.

## Exit criteria

Falsifiable, per the program. A phase that cannot state its criterion
in this form does not exit.

1. **The cold-boot beat.** In the successor rerun's offline-scored
   dimension, the scored browser arm — after a full process/browser
   restart with the backend unreachable — renders the authenticated
   application shell and retained authorized rows for its retainable
   queries: the scenario where Diary 0027 recorded Convex's "no
   authenticated application shell and zero retained query rows."
   Falsified if the successor diary records the same GAP-row family
   (cold retained boot, restart-safe queue, reconnect settlement) for
   the Snapback arm. Scope honesty: claimed for the retainable subset
   only; protected opaque queries stay out by design (LLP 0053).
2. **Arm claim parity.** The retention/replay claims on the JS/React
   arm match the Contract arm's: the guide capability rows
   `sync.offline` and `auth.authorized-leases` report shipped for the
   JS/React arm on the local target under exactly LLP 0043's proof
   rule. Structural deliverable, named in v0.3: today
   `guide/capabilities.md` carries one arm-agnostic row per
   capability, so the arm-scoped claim rows this criterion reads do
   not exist yet — Phase 0 delivers them (per-arm rows or an arm
   column, landing under LLP 0061's guide conventions with LLP 0043's
   proof rule as the row-level gate); the criterion is executable
   only once that structure exists. Falsified by any claim row on the
   JS arm lacking the Contract arm's proof set (durable store,
   complete retained identity, local IR-derivability where `Parity`
   is claimed).
3. **Tuple harness before any same-code claim.** Before the program
   asserts "same code both sides" anywhere, each execution-identity
   element has a per-element test harness: hash equality (element 1),
   attestation checks (element 2), the D5 conformance corpus passing
   on both executors (element 3), ledger record/replay (element 4),
   and an activation-carry check in the settlement submission
   (element 5). Falsified by a same-code claim shipped with any
   element untested.
4. **Claims equal acceptance.** Every phase's capability claims match
   exactly what its acceptance proves — no phase ships a manifest or
   guide claim its acceptance suite does not exercise. Falsified by
   any claim/acceptance mismatch found in review or rerun.

Criterion 1 binds to the JS/React browser arm (decision 2, decided
2026-07-30). Criterion 3's gate is the full ledger, restated in v0.3
against a misreadable v0.2 sentence: **all five unowned designs
(ledger rows 1–5) must land in owning documents before any
`Parity`-by-construction claim ships** — row 1's settlement Spec is
merely the first of them, and decision 10 being decided changes that
row's content, not the gate's breadth. Neither criterion weakened in
the resolution — only the binding was fixed.

**Which criteria bind which phases, and what "program complete"
means (v0.3).** Criteria 1 and 2 are Phase 0's exit: they bind the
Phase 0 arm and can pass with every later phase unexecuted — so
**Phase 0's exit is not program completion**. Criterion 3 binds
every phase from Phase 1 on that ships a same-code or
`Parity`-by-construction claim; it is vacuous only while no such
claim ships, and Phase 1's IR `Parity` claims make it live.
Criterion 4 binds every phase and the Option F rider. The program
is **complete** when all authorized phases — 0, 1, 2a, and 2b —
have executed with their named evidence gates passed and their
binding criteria met, and the Option F rider's disposition is
stated: either landed behind its acceptance-script gate or declined
by a dated note in this Plan. The mobile spike sits outside the
completion boundary by construction (a question, not a lane; its
disposition is OQ-grade, not phase-grade). A phase the program
abandons rather than executes exits only by a dated author decision
recorded here, naming successor authority if the scope moves.

## Measurement

The program's measurement is **the offline/cold-boot dimension of the
successor rerun** — the scenario dimension 0127 §Sequencing 6
proposes adding to the existing arms, cross-gated with LLP 0115
§Sequencing 5's rerun checkpoint. Composition, restated in v0.3
(v0.2's "one rerun serves both programs" silently decided it): rerun
composition — the contracts, the dimensions, whether this program's
offline scoring folds into the matrix rerun — is LLP 0115 open
question 4's adjudication. **Answered (2026-07-31): LLP 0130 SD-3
adjudicates 0115 OQ4** — the seven contracts run unchanged, the
React-surface measurement is included, and this program's offline
dimension folds into the same shared rerun, as this Plan proposed.
This program's diary-grade offline acceptance and the measurements
below remain independently mandatory, and the two programs' exits
stay separate either way. Two preconditions travel from 0127
§Measurement: Phase 0's diary-grade offline acceptance on the chosen
arm, and the normalized-profile burst benchmark before any
performance claim (0125 option 5 — its numbers are stale and
machine-confounded).

The named empirical questions from LLP 0126 this program must answer
(finding 11: nothing in the local-first corpus is measured today):

- the IR-evaluator sizing spike (Phase 1's gate);
- client-store footprint and replica-hydration cost;
- local-execution latency against settlement latency;
- the WASM assessment — size, performance, feasibility (0126 OQ5,
  Phase 2a's gate);
- the mobile spike with named success criteria (0126 OQ10);
- resume-storm behavior at reconnect scale (0126 §Hosted topology).

## Cross-gates with LLP 0115

LLP 0115 remains the parity program's sequencing authority; this Plan
is deliberately **not** a 0115 tranche — the two programs have
different exit criteria and 0127 §Sequencing 5 keeps them uncoupled.
LLP 0115 (from its v0.6, 2026-07-30) records these cross-gates
reciprocally, along with the registry of the ten adjudicated 0127
decisions (its open question 8 — cited by question, durable across
revisions). The shared substrate, by gate:

- **The sealed runtime artifact** (0127 move 5; 0115 Tranche A,
  CV-2/CV-3; LLP 0123): Phase 2b's sidecar carrier and the tuple's
  runtime-identity element. One artifact family serves the adopter's
  server and the app's embedded runtime.
- **The closed graph** (0127 move 2; CV-7; LLP 0118/0108): ground for
  every phase past 0 — a helper mechanism that broke closure would
  forfeit execution-identity element 1.
- **The profile vocabulary** (0127 move 6; CV-8; LLP 0080/0110):
  ledger row 2's proposed admission artifact for partial replication.
- **The rerun** (0115 §Sequencing 5): this program proposed adding
  the offline-scored dimension to that rerun — the fold is decided,
  LLP 0130 SD-3 answering 0115 OQ4 (§Measurement) — and, per 0115's
  requirement,
  at least one arm consumes the LLP 0114 React surface — the arm
  Phase 0 targets (decision 2 confirmed it).

## Open questions

Questions 1–2 were LLP 0127's open decisions carried verbatim in
scope; both were adjudicated 2026-07-30 and no longer gate this Plan
(§Decision posture).

1. **0127 decision 2 — DECIDED (v0.2)** (0126 OQ1/OQ7): the
   successor-Plan shape (this document), the JS/React arm as first
   carrier, and the two-parallel-ladder staging with IR-rung-first
   resourcing are confirmed. Option C (client mutators) is NOT
   admitted; it is held behind the named trigger recorded in open
   question 4. This Plan's authority, Phase 0's arm, and the phase
   structure are set.
2. **0127 decision 10 — DECIDED (v0.2)** (0126 OQ3): server
   re-derivation is the default for client-captured `now` and ids at
   settlement; client-captured values are carried in receipts as
   labeled claims, never authority; bounded-skew acceptance only as a
   per-field declared opt-in. Owner: a new settlement Spec under this
   program — the program's first owned-Spec deliverable. Ledger
   row 1 un-gates as that Spec lands; exit criterion 3's binding
   stands. Domain and lane scoping recorded at ledger row 1 (v0.3):
   the queued-intent replay lane keeps LLP 0008's shipped accept
   pin; re-derivation governs the local-execution lanes; the
   client-minted `clientMutationId` is protocol-lane identity
   outside decision 10's domain.
3. **First-arm fallback shape — MOOT (v0.2).** Decision 2 confirmed
   the JS/React arm as first carrier, so the Contract-arm-first
   fallback (0126 OQ1's alternative) does not arise; retained for the
   record only.
4. **Option-C trigger wording — RECORDED (v0.2, decision 2).** The
   named trigger, verbatim: admit option C only if the IR rung proves
   insufficient for browser-side write expressiveness after
   measurement. Residue, still open: who observes the measurement and
   where a dated admission decision would be recorded if the trigger
   ever fires. LLP 0130 ER-1 (2026-07-31) reserves the admission: the
   program may detect the trigger, but admitting option C is the
   author's call alone — no standing decision covers it. (0127's
   earlier phrasing — C "available if demand for
   arbitrary offline client logic arrives before D matures" — is
   superseded by the decided trigger.)
5. **Phase timeboxes and owners.** This Plan assigns none. Each phase
   needs a named owner and a timebox before it starts; whether those
   land as revisions here or as filesystem tickets per phase is an
   author call.
6. **The ephemeral no-sync pin.** Does the proposed LLP 0013
   amendment (0126 OQ8; constraint 4) land with Phase 0 or
   independently, and who writes it?
