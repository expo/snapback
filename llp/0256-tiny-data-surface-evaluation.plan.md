# LLP 0256: Tiny data surface evaluation

**Type:** Plan
**Status:** Accepted
**Systems:** Competitive evaluation, Developer experience, Authoring,
Application data API, React, Local sync, Offline sync, Authorization, Testing,
Publishing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-13
**Revised:** 2026-08-14
**Related:** LLP 0254, LLP 0252, LLP 0197, LLP 0102, LLP 0082, LLP 0065,
LLP 0253

## Summary

This Plan preregisters LLP 0254 D9's evaluation before a result from the tiny
surface is visible. It freezes the cells, workloads, concept rubric, aids,
replication, cost threshold, no-regression oracles, record extension, clock,
backstop, and publication order. It operationalizes rather than amends LLP
0254 D9/D10. The coordinated-experiment machinery comes from LLP 0252 D7
(`llp/0252-convex-familiar-authoring-profile.rfc.md:643-779`); the publication
and raw-record rules come from LLP 0197 and LLP 0102
(`llp/0197-benchmark-publication-standard.rfc.md:42-193` and
`llp/0102-seven-backend-five-app-bakeoff.plan.md:410-473,532-560`).

The frozen numbers are:

- `N = 5` attempts per configuration per round, with all attempts reported;
- separate `bare-v1` and `assisted-v1` results, never pooled;
- at least 25% lower active time **and** model tokens at first green **and**
  full acceptance, in each internal aid condition;
- 5/5 equal-proof successes in both internal lanes, with no correctness,
  authority, offline-settlement, evidence-confidence, or architecture
  regression; and
- one complete paired `N = 5` confirmation by a second model family before a
  cross-family default claim.

LLP 0254 delegates the numeric replication and effect size to this Plan. This
Plan interprets “material reduction” as the 25% joint time/token threshold: it
is large enough to represent a changed authoring experience rather than a
lines-of-code win, while `N = 5` exceeds LLP 0197's `N≥3` floor and supports
the counterbalance below. “First-green cost” is the pair of active time and
tokens through `firstGreenProofMs`; “completion cost” is the same pair through
`fullAcceptanceMs`, including independent proof, record validation, evidence,
inventory, and cleanup but excluding post-run grading/publication.

InstantDB is external calibration, not causal evidence. Chat is absent until
LLP 0254 OQ8's membership-read gate passes. Familiar is absent until a later,
separately preregistered tiny/non-tiny × explicit/familiar 2×2.

## Frozen first-comparison cells

The following table is reproduced verbatim from LLP 0254 D9 and is normative:

| Lane | Function profile | Workloads | Role |
| --- | --- | --- | --- |
| tiny data surface | `snapback-explicit-v1` (P) | Todo; day-two from that Todo app | treatment |
| explicit data path | `snapback-explicit-v1` (P) | Todo; day-two from that Todo app | named causal control |
| pinned InstantDB | — | Todo | external calibration only, excluded from the causal decision |

Each row runs in `bare-v1` and `assisted-v1`, producing six configurations per
initial round. A Snapback attempt is one chain: build Todo to acceptance, keep
that exact app and data identity, then evolve it on day two. InstantDB stops
after Todo. Tiny is a generated projection into `snapback-explicit-v1`, not a
third function profile or runtime (LLP 0254 D1).

Within each aid condition, cells run serially on one machine in this fixed
five-attempt order:

| Repetition | First | Second | Third |
| ---: | --- | --- | --- |
| 1 | tiny | explicit | InstantDB |
| 2 | explicit | InstantDB | tiny |
| 3 | InstantDB | tiny | explicit |
| 4 | tiny | InstantDB | explicit |
| 5 | explicit | tiny | InstantDB |

The assisted block runs after bare in odd-numbered rounds and before bare in
even-numbered rounds. The committed freeze assigns exact attempt IDs. An
operator may not reorder or replace an attempt after seeing a result. This is
the `N`-not-divisible-by-lanes balance allowed by LLP 0197
(`llp/0197-benchmark-publication-standard.rfc.md:56-65`).

## Frozen workloads and equal proof

### Owner-scoped Todo

The initial app has authenticated owners, a typed `todos` resource (title,
completed, server-owned identity, owner, creation time), an owner-leading
index, a bounded ordered query, and generated create/update/delete intents.
Sync-enabledness is the profile/resource default, not a fifth table choice.
The neutral proof requires:

1. Alice and Bob each see only their deterministic 25-row seed; Mallory sees
   none. Policy omission, descriptor tampering, forged owner/server fields,
   cross-owner access, missing index, excessive `take`, and unknown transaction
   chunks refuse before unauthorized data or work is admitted.
2. Alice creates, edits, completes, reopens, and deletes through the lane's
   ordinary path. Independent authority reads prove settlement. A second Alice
   client receives an attributed native live transition without polling.
3. An already-open client retains authorized rows offline; a closed-and-reopened
   client restores them from the canonical durable store.
4. While the target is unreachable, that cold client accepts one create and
   one update into durable custody, distinguishes prediction from queued state,
   closes and reopens again, then reconnects. Both intents settle exactly once;
   authority and an independent observer converge, with no false committed
   success or duplicate create.
5. Logout/user switch blank protected state and fence the old authority
   partition. Canonical proof, evidence-confidence, inventory, package/target,
   and cleanup receipts validate.

This is deliberately narrower than LLP 0102's shared-workspace Todo: D9 allows
only owner-scoped Todo before OQ8. The InstantDB Todo precedent proved cold
IndexedDB restore and queued create/update settlement
(`diaries/0027-todo-backend-bakeoff.diary.md:487-517`), but calibrates outcomes
rather than defining Snapback semantics.

### Day-two evolution of that Todo

The builder receives its own accepted Todo working tree and records. The clock
starts at the first read of the day-two brief. It may not reseed, start a new
project, copy another solution, replace the canonical client/store, or migrate
profiles. Day two adds all three cliffs:

1. **Audited completion.** Add immutable `todoCompletionAudits` and an explicit
   `completeTodoWithAudit(todoId)`. One bounded authoritative transaction reads
   the Todo, checks current authority and incompleteness, completes it, and
   inserts one audit keyed by Todo plus completion epoch. Two same-baseline
   concurrent calls leave one completion and one audit; one settles and one
   receives a typed terminal refusal. No audit may name another owner's or an
   incomplete Todo. Declared reach is one Todo plus at most one audit insert or
   unique lookup; no scan.
2. **Reviewer-to-editor transition.** Add permission-backing
   `todoCollaborators` with `reviewer | editor`. Alice invokes the
   authority-creating explicit function
   `changeTodoCollaboratorRole(id, expectedRole, nextRole)`. Bob is refused
   before promotion and may complete after it; Bob/Mallory cannot self-promote,
   stale `expectedRole` refuses, and demotion fences later completion.
   Membership reads and writes remain explicit, not an OQ8 tiny resource.
3. **Completion webhook.** Add explicit action
   `deliverTodoCompletionWebhook(auditId)`. It reads an authorized immutable
   audit, uses canonical server-only destination/credential configuration, and
   sends one request to the frozen deterministic receiver with an idempotency
   key derived from the audit. The receiver can accept once and drop the
   response: the first attempt remains `ambiguous`; retry reconciles to one
   provider delivery and one terminal application receipt. Only a current
   editor may invoke; outsiders and demoted users refuse before egress.

The explicit profile admits these bounded custom functions. Familiar v1 cannot
admit the full set: its `fetch`/`fetchStream` stubs refuse and other effect host
properties are absent (`llp/0253-familiar-profile-v1-api.spec.md:369-399`),
while `effects`/`runtime` route explicit and authority creation is non-default
(`llp/0253-familiar-profile-v1-api.spec.md:819-828`). That is why profile P is
explicit even though a familiar mutation can express some multi-row logic.

Acceptance reruns the original Todo proof and proves all cliffs without data or
identity migration, a second client/provider/cache/store/outbox/policy owner,
or stranded accepted intents. The tiny lane records each generated escape and
scaffold. Withdrawal must project declarations to canonical named operations
while already accepted intents drain under their original generation (LLP
0254 D10).

### Staging exclusions

- Chat evidence is forbidden until the admission procedure below completes.
- Familiar evidence is forbidden until the later preregistered 2×2; LLP 0252
  evidence remains companion evidence and is never inserted into this matrix.
- InstantDB gets Todo only. Its collaboration/effect results in diaries 0028–
  0031 remain context, not cells in this causal comparison.

## Concept-count method

The D2 unit is a **distinct required authored concept**: a behavioral rule the
accepted ordinary path requires the author to choose, configure, or coordinate.
It is distinct when independently teachable and changeable without merely
changing a value governed by another counted concept. It is not an export,
line, fact, file, command, tool call, or repeated use.

`table`, `access`, `query`, and `transact` each count once when their respective
facts live in one grammar. Fields/indexes/defaults are semantic facts under
`table`; policy kind/owner/allowed writes are facts under `access`; bounded
filter/order/projection/cursor are facts under `query`; operation/arguments/
prediction/custody/settlement are facts under `transact`. A separate live
registration, client policy filter, cache key, optimistic reducer, outbox,
retry ledger, invalidation contract, or settlement registry counts separately
when the author must coordinate it. Starter-owned authentication and generated
facts do not count unless the run must author a second auth mechanism or bridge.

Each capsule reports:

- `requiredAuthoredConcepts`, normative for the D2 `≤4` Todo budget; and
- `retrievedOrManipulatedConcepts`, including abandoned or debugging paths.

Every included concept records ID, label, first-action and final-source
evidence, rule summary, `required | encountered-only`, and an optional fold
under the four named concepts. Excluded candidates record `authored-fact`,
`generated-fact`, `repetition`, `command`, `mere-value`, or another explicit
rubric reason.

The action trace proposes candidates. After sealing, two independent raters
grade neutral attempt IDs from source, traces, aids, and failed paths without
seeing each other's grade or aggregate ratios. Syntax can reveal the lane, so
the record does not claim rater blinding. The gate is Cohen's kappa `≥0.80` on
inclusion and count difference `≤1`; otherwise a third rater adjudicates while
all grades and reasons remain public. Grading is outside run cost, consistent
with LLP 0193's post-run diagnostic boundary
(`llp/0193-errors-as-docs-completeness.plan.md:133-139`). The rubric, form,
candidate schema, and three hand-graded examples freeze before timed runs.

## Aids and dated InstantDB pin

`bare-v1` gives every lane the neutral product brief/UI shell, generated types
and JSDoc, ordinary package help, and error-directed first-hop public docs. It
gives no lane-specific starter, skill, recipe, worked app, MCP, prior-run notes,
or human hint. `assisted-v1` gives each internal lane a digest-bound bundle with
symmetrical slots: setup; schema/authority; read/live; write/offline; equal
proof; empty day-two escape scaffold; and first-hop diagnostics. The same
product facts and negative cases appear in both bundles, in lane-native syntax;
neither contains completed business logic.

Each aid manifest records ID, path/package/version, digest, eligibility, lane,
semantic topics, words/tokens, example count, and benchmark-shapedness. A
parity checker rejects a material semantic omission. Retrievals and all human
interventions are recorded. Bare and assisted results remain separate because
they measure different knowledge placement (LLP 0197, `llp/0197-benchmark-
publication-standard.rfc.md:142-156`).

Before InstantDB evidence counts, Phase 0 freezes
`benchmarks/tiny-data-surface/v1/inventories/instantdb-<YYYY-MM-DD>.v1.json`.
It records fetch time/reviewer; exact product, CLI, React/Core/Admin packages,
lockfile, plan, region, target lifecycle; official schema/permission/query/
transaction/auth/offline/React sources and digests; starter command/template;
official skills, rules, machine-readable docs, remote/local MCP and eligible
tools; public/private availability and bare/assisted eligibility; target
preflight; and normalized manifests for unarchivable hosted assets. This is
necessary because InstantDB exposes substantial agent-facing aids
(`llp/0082-instantdb.research.md:289-314`). The prior Todo capsule proves the
available record shape (`demos/backend-bakeoff/arms/todo/instantdb/run-
capsule.v1.json:2-509`) but did not isolate knowledge placement. A material
InstantDB or aid change starts a new unpooled configuration at `N = 5`.

## Run protocol and measurements

### Configuration identity

The two internal lanes share the exact externally consumable Snapback closure
and runtime, target, model/build/family/settings/context, tools/harness,
machine/load/cache posture, credentials/personas, neutral prompt/shell,
budgets, proof, record schema, redaction, stop rules, and assistance policy.
InstantDB shares model, machine, neutral shell, budgets, outcomes, and record
bar while retaining provider-specific packages, auth, target, and lifecycle.

Each attempt starts with a cold model context, clean project, and fresh backend
and local stores. Source inspection is allowed only if a published diagnostic
routes there, and is recorded. Changing a semantic package, model/settings,
prompt, aid, starter, target, workload, oracle, schema, or amendment creates a
new digest-bound configuration version and a fresh `N = 5`; no values pool
across versions. Failed, timed-out, capability-failed, and invalid-evidence
attempts remain in the denominator. A repair is a new attempt, never a
replacement.

Before a cross-family default claim, a second model family repeats tiny and
explicit at `N = 5` in both aid conditions. It need not repeat InstantDB.
Tokens compare only within a model family; family results confirm rather than
pool. This freezes LLP 0252 D7's cross-family rule
(`llp/0252-convex-familiar-authoring-profile.rfc.md:673-677,726-733`).

### Time and tokens

Active time starts at the first lane-specific read or provider project command
and includes install, declaration, generation, client/backend work, debugging,
proof, repair, record finalization, and required cleanup. Only predeclared human
wait, provider outage, or machine unavailability may pause it, with monotonic
endpoints and reason. Credentials prepared before the run are excluded;
unplanned credential repair counts.

All marks are monotonic milliseconds from origin; UTC is provenance only:

| Mark | First qualifying event |
| --- | --- |
| `firstLocalReadMs` | Product client returns a non-vacuous authorized row from the ordinary path. |
| `firstAuthoritativeWriteMs` | A client ordinary write is independently observed committed; prediction does not qualify. |
| `firstProvenLiveTransitionMs` | A non-initiating client observes that commit through attributed native push, without polling/refresh. |
| `firstDurableOfflineSettlementMs` | An offline-custodied write survives close/reopen and settles exactly once after reconnect. |
| `firstGreenProofMs` | The complete mandatory functional proof command first passes on current source. |
| `fullAcceptanceMs` | Fresh independent proof plus capsule, evidence, inventory, architecture oracle, and cleanup validate. |

Each mark links the applicable client/authority/transport/store/proof receipt.
Missing marks are `null` with terminal reason. Day two records incremental
`dayTwoStartedMs`, `dayTwoFirstGreenMs`, and `dayTwoFullAcceptanceMs` plus
cumulative time. The primary cost ratios use Todo; day-two cost and pass/fail
cliff results are separately mandatory.

The harness records input, output, cached, and reasoning tokens per model turn
and cumulative totals at every mark; unavailable classes are `null`, never
estimated. It also records normalized tool call ID/class/start/end/status,
command digest, files/endpoints touched, and lane-assistance eligibility.
Public records retain normalized events and evidence IDs; sensitive raw tool
arguments remain private with keyed commitments.

### Mistakes, escapes, schema extensions

A **mistake** is a builder action later reversed or repaired to reach the frozen
proof. Each has first evidence, detection, correction, elapsed/token/tool cost,
source (`model | aid | product | environment | harness | unknown`), and one
primary class:

- `permission`: authority, actor, descriptor, secret, revocation, or leakage;
- `bound`: index/order/limit/reach/idempotency, or unbounded work;
- `lifecycle`: live attribution, cache/store retention, logout/switch, cleanup;
- `settlement`: prediction/custody/queued/committed/ambiguous/retry truth.

Secondary tags are allowed but not double-counted. Product attribution requires
a misleading/absent product surface; environment/harness faults cannot be
laundered into product friction. Correction loops run from first failing action
through the next relevant pass, including every action and intervention.

A **function escape** begins when tiny Todo cannot stay within the generated
ordinary path and ends when the explicit custom function/action plus caller and
proof pass. Record trigger, category (`multi-row-invariant | role-transition |
external-effect | other`), generated scaffold, authored concepts/facts, files,
time/tokens/tools, profile, bounded reach, authority/effect metadata, data or
client-ownership migration, and whether the explicit control required the
same work. Every day-two item must appear; extra escapes remain visible.

The versioned attempt record is
`run-capsule.tiny-data-evaluation.v1.json`. It extends the established bakeoff
capsule shape with closed, schema-validated fields:

```text
schemaVersion, protocolId, attemptId, roundId, configurationVersion/digest
lane, workloadChain, aidCondition, model, environment, packageClosure, target
budget, actors, order, prompts, aids, commands, normalizedActionTrace
milestones, tokenUsage, toolCalls, corrections, mistakes, interventions
conceptCandidates/grades, semanticFacts, functionEscapes, schemaExtensions
scenarioResults, proofReceipts, evidenceConfidence, architectureOracle
inventory, assistanceEvents, evidenceIndex/privateCommitment, stopDefects
cleanup, terminalOutcome, result
```

Unknown fields refuse validation. Each evidence reference has stable ID,
digest, media type, public/private class, producer, time, and redaction reason.
The schema checker verifies monotonic marks, token sums, tool/action coverage,
concept-grade linkage, complete mistake/escape intervals, terminal outcome,
all eight confidence dimensions, and public/private commitments. A required
new field needs capsule v2 and a new configuration version; additive optional
Chat fields are reserved below.

## Preregistered decision rule

For each complete round and aid condition, compute medians across the five tiny
and five explicit attempts:

```text
tiny/explicit firstGreenProofMs
tiny/explicit total tokens through first green
tiny/explicit fullAcceptanceMs
tiny/explicit total tokens through full acceptance
```

All four ratios must be `≤0.75` in `bare-v1` and again in `assisted-v1`.
Publish every value, median, range, ratio of medians, and median of
position-paired ratios. Calls, source volume, concepts, and corrections are
diagnostics and cannot rescue a primary miss. Ratios are only descriptive when
each lane has at least four successes and success rates differ by no more than
20 percentage points; otherwise capability is the headline, per LLP 0197
(`llp/0197-benchmark-publication-standard.rfc.md:121-133`). Promotion is
stricter: both internal lanes must be 5/5.

Tiny is promotion-eligible only when all of these match or exceed explicit:

1. **Correctness:** every mandatory scenario passes 5/5; no weaker proof,
   polling, client scan/filter, duplicate, invariant break, or authority/
   observer divergence substitutes.
2. **Authority:** omission/tampering/forgery, cross-owner actions,
   self-promotion, stale transitions, outsider calls, demotion, logout, and
   user switch fail closed. Permission-backing tables get no generic writes.
   LLP 0065 is the minimum generated-pattern test class
   (`llp/0065-generated-data-pattern-soundness.rfc.md:120-221,343-403`).
3. **Offline settlement:** 5/5 prove cold retained data, durable custody while
   unreachable, close/reopen, exactly-once settlement, independent convergence,
   and purge/fencing. Prediction, custody, queued, and settled remain distinct.
4. **Evidence confidence:** both lanes score `2` in all LLP 0102 dimensions—
   actor/authority, transaction/conflict, transport, offline/reconnect,
   settlement, target identity, cleanup isolation, reproducibility—for 16/16;
   tiny trails on none (`llp/0102-seven-backend-five-app-bakeoff.plan.md:546-560`).
5. **Surface and cliff:** tiny Todo has `≤4` required concepts, and day two is
   5/5 through bounded explicit escapes without profile/data/client-ownership
   migration or stranded accepted intents.
6. **One-owner architecture:** static/runtime audit finds zero second production
   runtime, transport, cache, local store, auth coordinator, outbox, settlement
   registry, policy evaluator, or diagnostic type (LLP 0254 D8/D9).

InstantDB never enters these calculations. A current-version default claim
also needs the second-family confirmation. If the clock ends without a
complete threshold-bearing current round, promotion is ineligible; it is not a
license to pool versions or lower the threshold.

## Clock and missed-disposition backstop

The D9 clock starts at the registry `publishedAt` of Phase 4's first qualified
publication of the exact tiny Experimental package closure, before any D9
result is observed. Prototypes, dry runs, private tarballs, and partial packages
do not start it (LLP 0254 D9).

A publication qualifies only when the closure names all tiny/control/generated
client/runtime/proof/guide/skill artifacts; both internal lanes use one runtime;
the preregistration, freeze, schema, prompts, aids, order, proof, and checked
publisher are committed; metadata remains `Experimental` and non-default;
withdrawal/drain proof passes; and the backstop below is installed and tested.
The receipt records publication identity, closure digest, start UTC, and
`stopAt = start + 90 days`. Stop is the earlier of three complete qualified
rounds or `stopAt`; configuration changes never reset the calendar.

For this Plan, a **complete round** means that every cell × aid configuration
admitted by one frozen matrix/version has exactly five schema-valid capsules
with terminal outcomes. Failures count and can make the round ineligible for
promotion; they do not make it incomplete. This interpretation prevents
best-of replacement or a permanently unfinished round from extending D9.

Only a dated Charlie Cheever amendment committed before the active stop may
extend it. The amendment names missing evidence, observed maintenance cost,
new maximum date/round count, and eligible versions. No operator may infer an
extension.

Before publication qualifies, Phase 4 adds
`scripts/tiny-data-evaluation-backstop.mjs` to the existing scheduled
`scripts/drift-prone-gates.mjs backstop` path. Existing machinery already runs
the backstop, limits its commit to `issues/*.md`, rebases, and pushes
(`scripts/drift-backstop-runner:102-129`), on the installed two-hour launchd
schedule (`scripts/install-drift-backstop-schedule:32-45`).

Phase 4 installed that exact check and integration on 2026-08-14. Its frozen
doorway pin, clock instructions, unarmed manual dry-run receipt, and observed
schedule status live under `benchmarks/tiny-data-surface/v1/clock/` and
`preregistration/experimental-doorways.v1.json`; the fixture matrix proves the
required boundary and issue-only behavior before any publication receipt
exists. This is an implementation record, not a protocol amendment or clock
start.

At the stop, absent a recorded D10 ruling, the new check must:

1. enforce the RFC default: tiny stays Experimental, gains no compatibility
   promise, and becomes no default/recommended doorway;
2. create or update exactly one signature-bound open ticket
   `issues/<YYYYMMDD>-tiny-data-surface-d10-disposition.md`, linking closure,
   clock, completed rounds, raw index, and all five D10 choices; and
3. return a stable missed-disposition verdict, never an inferred `continue`.

After disposition the resolution is recorded and the ticket moves to
`issues/closed/`. The existing registry establishes one-open-ticket behavior
(`scripts/drift-prone-gates.mjs:1646-1676,1717-1755`). Before clock start,
fixture tests with an injected clock prove pre-deadline silence, both boundary
triggers, idempotence, freeze enforcement, disposition suppression, prospective
extension, fail-closed malformed receipts, and intended-only issue staging. A
manual dry run and schedule-status receipt are retained.

## Chat admission

Chat remains excluded unless all of these exist:

1. a versioned membership-read `DataResourceV1` profile specifying policy,
   relationships, index/order/bounds, materialization identity, dependencies,
   retention/custody facts, explain output, and refusal routes;
2. LLP 0065-class negative tests for missing policy, outsider/nonmember reads
   and subscriptions, client descriptor widening, reverse-link dependency,
   membership/role loss on an established live result, cross-authority cursors
   and cache partitions, and no generic writes to permission tables;
3. accepted canonical owners for lease, retention, logout/switch, pagination,
   membership invalidation, and real-store offline/convergence; and
4. independent security review finding no post-filter, client scan, polling,
   default-allow, or generic authority-creation fallback.

Charlie Cheever must then commit a dated amendment **before any Chat result is
run or inspected**. It names the profile/reviews and freezes the brief,
scenarios, proof, aids, order, `N = 5`, 25% threshold, target/model/closure, and
new digest. It adds Chat only to tiny and explicit unless an external Chat
calibration is separately preregistered; Familiar stays excluded. Results do
not pool and the clock does not reset.

The reserved additive `chatAdmission` capsule object carries amendment,
profile, and review digests plus evidence for membership reads, stable cursor
pagination, live delivery, cold retention, queued settlement, membership/role
invalidation, and canonical ephemeral use. Ephemeral presence is
`canonical-shared-surface`, excluded from tiny concept/effect claims;
membership/role writes remain explicit escapes. Anything beyond these optional
fields requires capsule v2.

## Publication and D10 packet

Publication-safe artifacts land under:

```text
benchmarks/tiny-data-surface/v1/
  preregistration/  inventories/  prompts/  aids/  schemas/
  rounds/<round>/<configuration>/<attempt>/
    run-capsule.tiny-data-evaluation.v1.json
    receipts/
  raw-record-index.v1.json
```

Private transcripts and sensitive originals live in an access-controlled store
addressed by opaque evidence IDs; keyed commitments enter the repository. The
public tree includes every attempt, normalized actions, validated capsule,
safe receipts, redaction reasons, and reproducibility manifest. A disclosure
reviewer approves the boundary.

The checked publisher refuses any table, chart, ratio, score, or D10 aggregate
until the applicable raw index is committed, all digests validate, and every
frozen attempt has a terminal record. Raw records land in an earlier commit
than the first summary. Corrections append errata and recompute; failed attempts
are never rewritten. This applies LLP 0197's record-first rule
(`llp/0197-benchmark-publication-standard.rfc.md:26-40,167-193`).

At the stop, the generated decision packet contains:

- clock/closure/preregistration/amendments, configuration lineage, and complete
  or incomplete round inventory;
- all attempt outcomes and values, denominators, medians/ranges/ratios, aid and
  model splits, configuration-version boundaries, and threshold verdicts;
- concept grades/disagreements, facts, files/commands/source volume, aid use,
  corrections, interventions, mistakes, escapes, and schema extensions;
- separate correctness, authority, offline, confidence, concept-budget,
  withdrawal, cliff, and one-owner verdicts;
- InstantDB with dated pin and visible exclusion from causal calculations;
- Chat admission evidence or `not admitted — OQ8 unresolved`, and Familiar as
  separately deferred;
- tiny-exclusive maintenance cost, defects, qualification time, docs/package
  duplication, and coexistence confusion; and
- an eligibility table for **promote, continue, revise, fold, withdraw**, with
  every unmet gate linked to raw evidence.

The packet does not rule for the author. Promotion additionally requires the
teach-one-doorway decision composing tiny with LLP 0252's familiar aliases
(LLP 0254 D10). No ruling at the stop means the automatic Experimental freeze
and issue, not silent continuation.

## Amendments and phase gates

An amendment is prospective, dated, author-approved, and committed before the
first affected result. It lists changed fields, reason, new configuration,
earlier-record relevance, and any clock effect. A nonsemantic harness repair
gets a new attempt and patch version while preserving the failed record; any
ambiguity is material and unpooled. Capability failures are not timeouts.
Secret exposure, cross-user leakage, destructive cleanup, or a false capability
claim stops that configuration pending review, following LLP 0102's Stop
discipline (`llp/0102-seven-backend-five-app-bakeoff.plan.md:310-334,673-686`).

Phase 0 lands this Plan, the follow-on API Spec and review, workload/proof,
concept rubric, aids and pin, schedule, capsule fixtures, redaction contract,
publisher, and freeze verifier. Non-executed projections are design review, not
results. Phases 1–3 may validate declarations and instrumentation but cannot
produce promotion evidence. Phase 4 installs/tests the backstop, publishes the
qualified Experimental closure and clock receipt, executes counterbalanced
rounds, lands raw records before summaries, generates the packet, and requests
the author ruling.

## Open questions, owners, and defaults

| Underdetermined item | Owner | Default until resolved |
| --- | --- | --- |
| Final package/subpath and descriptor syntax | Follow-on API Spec author and package owner | Bind the qualified closure's semantic/profile identities; no timed run before the Spec. |
| Whether an OQ8 membership-read profile passes Chat admission | Membership Spec/authorization owners and independent security reviewers | **No; Chat excluded and no collaborative promotion claim.** |
| Whether familiar aliases coexist with a promoted tiny doorway | Charlie Cheever in the composed LLP 0252/0254 disposition | Both stay Experimental and non-default; this Plan promotes neither alone. |
| Too few current-version or cross-family runs at the stop | Charlie Cheever | Promotion ineligible; publish insufficiency and choose continue/revise/fold/withdraw, otherwise automatic freeze/ticket. |
| Location and policy of the private trace store | Benchmark infrastructure owner and disclosure reviewer | No claim depending on private evidence until a keyed, access-controlled, fail-closed store is named. |

Replication, effect threshold, workloads, aid split, concept rubric, and
backstop behavior are no longer open once this Plan is accepted.

## Status

Accepted (2026-08-13, author-directed, alongside LLP 0255's acceptance —
run journal: `llp/reviews/0255-tiny-data-surface-v1-api.run.md`). The
preregistered protocol above is frozen as of this acceptance; it does
not claim that the surface, capsule, aids, backstop, package closure,
pin, or any D9 result exists. A timed run before the applicable Phase 0
and Phase 4 start gates is invalid evidence.
