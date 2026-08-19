# LLP 0286: Clean-room Snapback reconstruction experiment

**Type:** Plan
**Status:** Draft
**Systems:** Project, Architecture, Competitive evaluation, Benchmarks,
Agent experience, Runtime, Storage, Live Queries, Code generation,
Diagnostics, Security, Testing, LLP governance
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-15
**Revised:** 2026-08-15 (initial Draft)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0009,
LLP 0010, LLP 0012, LLP 0035, LLP 0037, LLP 0061, LLP 0093, LLP 0094,
LLP 0095, LLP 0146, LLP 0175, LLP 0189, LLP 0197, LLP 0225, LLP 0232,
LLP 0236, LLP 0250, LLP 0256, Diary 0020,
https://epoch.ai/publications/mirrorcode-preliminary-results,
https://metr.org/blog/2025-08-12-research-update-towards-reconciling-slowdown-with-time-horizons/

## Summary

Run a bounded, source-blind experiment to answer two separate questions:

1. Can Snapback's intent and observable contracts be distilled into a compact,
   implementation-independent specification from which a fresh agent can build
   a conforming implementation?
2. Given that specification, can one of several frontier software-development
   model families produce a local-core implementation that is materially
   better than the incumbent on correctness, security, performance,
   maintainability, and agent-facing diagnosability?

The experiment does **not** begin by recreating the whole repository and does
not authorize a replacement, migration, or parallel production core. It first
targets a deliberately bounded **K1 local kernel profile**: one trusted local
app, Rust + SQLite + Ibex, deterministic generation and activation, indexed
queries, transactional mutations, commit versions and conflict validation,
live-query snapshot/update delivery, reset/seed, explicit capability reports,
and structured diagnostics. Auth-provider/session machinery, assets, cron,
actions, ephemeral state, offline client custody, Cloudflare, deployment,
first-party UI/client packages, and publication are outside K1.

Before any official candidate sees the task, the program freezes:

- a product constitution and K1 target profile;
- a clause-addressable normative contract pack;
- machine-readable wire/schema fixtures and explicit nonclaims;
- a private clause-to-evidence traceability map;
- a visible conformance suite;
- two sealed holdouts and three preregistered day-two change tasks;
- the incumbent snapshot and execute-only oracle;
- exact candidate model identities, prompts, budgets, attempt ids, machines,
  stop rules, scoring rules, and publication posture.

At least three independent model families receive the same public pack, the
same source-blind tool environment, and the same oracle budget. After one
discarded calibration run improves the instrument, the official tournament
runs `N = 3` attempts per family. All attempts are retained; there is no
best-of sampling. A candidate is inadmissible if it misses any load-bearing
correctness, durability, security, deterministic-artifact, or source-blindness
gate. Weighted scoring, architecture review, performance comparison, and
day-two change cost happen only among admissible candidates.

The most likely valuable result is not a replacement binary. It is a tested
semantic specification, a defect ledger for the corpus and incumbent, and
concrete alternative architectures that can improve LLP 0225's incremental
owner-extraction program. A production successor can be considered only by a
later author-ratified Decision that explicitly amends or supersedes LLP 0225's
“no rewrite, no second implementation, no flag-day” rule.

## Motivation

### Why this is unusually plausible for Snapback

Snapback already owns most of the ingredients that make a clean-room build
tractable:

- a ratified product root and large subsystem LLP corpus;
- generated schemas, stable wire envelopes, capability manifests, diagnostic
  codes, and versioned fixtures;
- deterministic resets and reference applications;
- a registered affected/complete proof inventory;
- a guide whose capability rows distinguish shipped behavior from GAPs;
- implementation history in issues, diaries, research reviews, and closed
  defect regressions; and
- an agent-first contract that values machine-readable observation over
  undocumented operational knowledge.

Diary 0020 is direct local evidence. A clean-room Swift client built from LLPs
0094/0095 and committed fixtures reached a working implementation without
reading the JS client. The build also found four specification defects in the
connective tissue between schemas: drain framing, unsubscribe authority
custody, bootstrap mechanics, and fixture judgment. The second implementation
was valuable both because it worked and because it exposed what the documents
had failed to say.

External evidence points in the same direction while supplying an important
scale warning. The 2026 MirrorCode preliminary result reports a source-blind
reimplementation of a roughly 16,000-line, 40-command program against 2,001
end-to-end tests. Its roughly 61,000-line language target remained unsolved at
the reported budget, and an early eager-evaluation choice trapped later work.
Snapback is much larger, stateful, concurrent, security-sensitive, and
cross-target. The evidence supports a bounded experiment with a strong oracle;
it does not support a one-shot whole-repository rewrite.

### Why the specification pass is independently valuable

The LLP corpus is a living decision and evidence record, not one normative
product specification. It intentionally contains:

- ratified intent beside implementation status;
- Accepted contracts beside Draft proposals;
- historical ledgers and superseded choices;
- observed implementation behavior that may be accidental;
- explicit GAPs and must-not-claim boundaries; and
- research recommendations that have never become product decisions.

An agent that simply ingests every LLP and current test will receive both the
product's genome and its archaeological record. It may reproduce contradictions,
obsolete paths, or incumbent accidents. The distillation therefore has to make
provenance and precedence explicit. A compact, clause-addressable pack is also
a stronger test of LLP completeness than another model reading the entire
repository with source access.

### Why “passes the tests” is not enough

The experiment asks whether an implementation is *better*, not merely whether
it can produce expected outputs. Algorithmic checks systematically miss
documentation quality, omitted tests, brittleness, architecture, and ease of
future change. Snapback's own load-bearing properties also include crash
recovery, concurrency, capability honesty, authorization boundaries, resource
behavior, and failure diagnostics.

The evaluator therefore combines sealed behavioral tests with adversarial
security review, repeated performance measurements, anonymous architecture
review, and equal day-two change tasks. A weighted score can rank candidates
only after the non-negotiable gates pass.

## Relationship to governing LLPs

This Plan operationalizes, and does not amend:

- **LLP 0000:** product intent, target stack, agent-first posture, non-goals,
  and canonical local target;
- **LLP 0010:** deterministic harness, structured diagnostics, capability
  honesty, and acceptance-ladder principles;
- **LLP 0189:** evidence and claims bind a scoped snapshot rather than a
  perpetually moving `main`;
- **LLP 0197:** preregistration, all-attempt reporting, machine records,
  counterbalancing, equal-proof disclosure, and receipt-backed evaluation;
- **LLP 0225:** production core evolution remains incremental owner extraction;
  there is no second production implementation or flag-day cutover; and
- **LLP 0232:** ordinary repository work continues independently and is not
  held hostage by a long-running experiment.

The candidate workspaces are research artifacts, not a second supported core.
They live outside the production source tree and receive no package, capability,
deployment, or compatibility claim. Landing a generally useful spec correction
or evaluator regression is ordinary Snapback work and follows its owning LLP;
landing candidate implementation code requires a later, scoped adoption
Decision.

If the author wants the experiment itself to permit a production successor,
LLP 0225 must be amended before that permission exists. Acceptance of this Plan
alone is not such an amendment.

## Research questions and preregistered hypotheses

### Questions

1. **Specification completeness:** what fraction of K1 behavior can a fresh
   implementer derive without source access or human clarification?
2. **Semantic convergence:** where do independent families choose the same
   behavior and architecture, and where do they diverge?
3. **Incumbent accidents:** which current behaviors are neither required by
   ratified intent nor useful enough to preserve?
4. **Architecture quality:** can a fresh implementation preserve Snapback's
   hard invariants behind clearer ownership and commit boundaries?
5. **Verification sufficiency:** which incumbent guarantees are not observable
   through the current conformance and acceptance surfaces?
6. **Economic feasibility:** how much inference, wall time, intervention, and
   evaluator work does a conforming implementation consume?
7. **Day-two fitness:** does a clean architecture make three previously unseen
   product changes cheaper without weakening evidence?
8. **Scale path:** does K1 produce enough success to justify expanding toward
   auth/offline clients, the full local product, or a second target?

### Hypotheses

- **H1:** at least one family produces a bootable K1 implementation that passes
  all visible happy-path checks.
- **H2:** no first official submission passes every sealed load-bearing gate;
  the failures identify material omissions in either the spec or implementation.
- **H3:** at least two families independently surface the same missing or
  ambiguous normative clause.
- **H4:** at least one candidate has a materially cleaner owner/commit graph
  than the incumbent, even if it is not replacement-ready.
- **H5:** the incumbent remains stronger on adversarial and recovery behavior
  unless that behavior is expressed as an executable contract.
- **H6:** the experiment yields enough reusable specification and evaluator
  value to justify its cost even if no candidate is admissible.

These are hypotheses, not desired conclusions. Negative results and all failed
attempts remain part of the record.

## Definitions

- **Incumbent:** the pinned Snapback commit and qualified runtime artifacts
  selected in E0.
- **Candidate:** one source-blind implementation attempt produced under the
  official frozen run protocol.
- **Family:** one independently trained frontier model family. Different
  versions or effort settings from one provider are not independent families.
- **K1:** the bounded local-kernel profile in this Plan.
- **Public pack:** every artifact a candidate may read.
- **Private provenance pack:** source paths, implementation observations,
  evaluator rationale, and issue/test mappings withheld from candidates.
- **Visible suite:** tests candidates may run during implementation.
- **Holdout A:** sealed tests run after initial submission; candidates receive
  category-level feedback for one equal remediation round.
- **Holdout B:** untouched final tests used for the terminal ranking.
- **Load-bearing gate:** a binary requirement whose failure makes a candidate
  inadmissible regardless of weighted score.
- **Oracle:** a brokered execute-only projection of the incumbent. It answers
  bounded black-box requests and exposes no source, filesystem, package, or
  test artifacts.
- **Better:** admissible and materially superior to the incumbent on the
  preregistered combined evaluation. Smaller or prettier alone is not better.

## K1 target profile

### Required substrate

Every candidate uses the same product-shaping substrate:

- Rust for the server and host implementation;
- stock SQLite for durable application state;
- the documented Ibex/Hermes host ABI supplied as a prebuilt dependency;
- one trusted local app and one process-local app instance;
- the same frozen Rust, Node, and SQLite toolchain authorities;
- the same host OS/machine class for scored development runs; and
- the same predeclared third-party dependency mirror.

This keeps the experiment focused on implementation architecture rather than a
language, engine, or product-direction bakeoff. A candidate may choose its own
module graph, internal types, SQL layout, libraries from the frozen mirror, and
execution strategy so long as the observable contracts and hard boundaries
hold.

### Required observable capabilities

K1 includes:

1. **Source and artifact identity**
   - deterministic schema and function inputs;
   - generated schema/function/capability/diagnostic artifacts;
   - complete-graph freshness and fail-closed stale-artifact refusal;
   - atomic activation of one complete successor generation;
   - no partial serving of a rejected generation.
2. **Schema and portable data shape**
   - typed tables, fields, system fields, and named indexes;
   - deterministic reset and declarative seed;
   - one portable indexed single-table query family;
   - bounded result size and explicit unsupported-query refusals.
3. **Handler execution**
   - registered query and mutation handlers on Ibex;
   - async completion under the documented host/runtime boundary;
   - snapshot reads and read-your-writes behavior;
   - deterministic/recorded ambient values where K1 permits them;
   - structured refusal when code or host behavior leaves the supported
     profile.
4. **Transactional writes**
   - one atomic commit version per accepted mutation;
   - no durable partial mutation;
   - commit-time read-set conflict validation;
   - gap-free app-local commit visibility order;
   - durable change records sufficient for the K1 live path.
5. **Queries and live delivery**
   - authoritative finite query response;
   - live subscription with an authoritative initial snapshot;
   - replace delivery for the general K1 live subset;
   - incremental row delta only where the declared/captured query semantics
     make it sound;
   - reconnect/resnapshot or an explicit capability refusal, exactly as the K1
     contract selects;
   - teardown that actually releases subscription ownership.
6. **Development and inspection surface**
   - readiness descriptor bound to the running instance;
   - structured diagnostics with stable codes and remediation fields;
   - capability manifest that reports every K1 inclusion and exclusion;
   - inspection of generation identity, database version, connections,
     subscriptions, and recent failures;
   - deterministic machine-readable acceptance results.
7. **Boundaries**
   - app-data and system/operator route separation;
   - admin authority on every operator route in scope;
   - bounded request, result, and retained state sizes;
   - no ambient filesystem, process, network, or secret capability in K1
     handlers;
   - fail-closed behavior for malformed, stale, unknown, and unsupported input.

The distilled K1 Spec, not this checklist, supplies exact fields and state
machines. Every item above must map to at least one normative clause and one
evaluator witness before E3 closes.

### Explicit K1 exclusions

The candidate must report, rather than simulate or half-implement:

- production auth providers, sessions, credential custody, password auth,
  sender-constrained browser credentials, and hosted auth;
- policy-aware protected offline retention and durable client mutation replay;
- first-party React, Expo, Contract/Exact, Swift, Kotlin, or Dart packages;
- assets, media processing, notifications, push, cron, durable jobs, and
  outbound actions;
- ephemeral presence/state;
- Postgres, Cloudflare, Fly, hosted multi-tenancy, backup/restore, and remote
  deployment;
- MCP, admin UI, website, demos beyond the K1 proving fixture, and publication;
- resource-isolation or scale claims that the K1 evaluator does not prove.

An excluded capability presented as working is a capability-honesty failure.
An exact, actionable missing-capability report is correct behavior.

## Specification distillation protocol

### Truth hierarchy

The distiller classifies every candidate-facing clause by this precedence:

1. **Author-ratified direction and Decisions.** LLP 0000's ratification ledger
   and later Accepted Decisions control conflicting lower sources.
2. **Accepted/Implemented normative subsystem contracts.** Exact scoped
   contracts control implementation observations.
3. **Committed language-neutral artifacts and conformance fixtures.** These
   pin closed shapes where their governing LLP grants them authority.
4. **Shipped code and tests, observed together.** These show current behavior
   but do not convert an accident or known defect into desired semantics.
5. **Draft/Review LLPs and active plans.** These identify candidate direction
   and open choices, never an unmarked K1 requirement.
6. **Research, diaries, reviews, issues, and history.** These supply evidence,
   failure cases, and rationale, not authority by themselves.

When two sources disagree, the distiller does not silently choose. It writes an
adjudication entry naming the sources, affected clauses/tests, proposed
resolution, and required author or owning-LLP action.

### Provenance labels

The private traceability map labels each claim:

- `author-ruled` — explicit ratified direction;
- `accepted-contract` — normative accepted/implemented LLP clause;
- `artifact-pinned` — authority delegated to a schema/fixture/registry;
- `observed-incumbent` — code and tests agree at the frozen snapshot;
- `known-deviation` — incumbent behavior is a defect or intentional temporary
  mismatch against the desired contract;
- `draft-candidate` — proposed behavior excluded from K1 unless separately
  decided; or
- `inferred` — synthesis requiring review before it can become normative.

No `inferred` or `draft-candidate` entry enters the candidate-facing normative
pack. `Observed-incumbent` enters only after reviewers decide that preserving it
is desired behavior rather than compatibility archaeology.

### Public and private products

The distillation produces:

```text
spec-pack/
  00-constitution.md
  01-k1-target-profile.md
  02-nonclaims.md
  normative/
    artifacts.md
    schema-and-data.md
    handler-runtime.md
    transactions.md
    queries-and-live.md
    routes-and-authority.md
    diagnostics-and-inspection.md
  contracts/
    schemas/
    wire-fixtures/
    diagnostic-registry.json
    capability-profile.json
  examples/
  visible-tests/
  ambiguity-protocol.md
private-provenance/
  clause-traceability.json
  adjudications.md
  incumbent-deviations.md
  evaluator-coverage.json
```

The public normative files use stable clause ids such as `K1-TXN-ATOMIC-01`.
The private map links each clause to exact LLP anchors, artifacts, tests, code
observations, issues, and reviewers. Candidate-facing prose omits private source
paths and internal symbol names unless they are themselves public contracts.

### Compactness and retrieval

The public prose pack should fit within a recommended 150,000-token first-load
budget, excluding machine fixtures and examples. No individual subsystem file
should exceed 30,000 tokens. A generated index maps intent, capability, route,
diagnostic, artifact, and state-machine terms to exact clauses.

If the required K1 semantics cannot fit this shape without lossy omission, E1
reports that result rather than deleting nuance. Candidates may retrieve any
public subsection and fixture on demand; they are not required to hold the pack
in one context window.

### Desired behavior versus incumbent parity

Every evaluator case states one of:

- `parity` — the desired result matches the incumbent;
- `corrected` — the normative desired result intentionally differs from a known
  incumbent defect;
- `nonclaim` — both systems must refuse or report unsupported;
- `candidate-only-testability` — a test/fault hook required of experimental
  candidates but not a product capability; or
- `incumbent-only-observation` — measured for context and excluded from ranking.

This prevents both common errors: rewarding a candidate for reproducing a bug,
and penalizing it for not implementing an aspirational GAP.

## Evaluation instrument

### Freeze before official runs

The following must exist, validate, and be content-addressed before E4 begins:

- the complete public pack;
- the private provenance pack;
- visible suite V;
- holdout suites A and B;
- the K1 fixture generator and mutation corpus;
- the fault/concurrency schedule;
- the security review rubric;
- the repeated performance workload and machine protocol;
- three sealed day-two tasks;
- the incumbent build and oracle broker;
- the candidate machine image and dependency mirror;
- the run-record schema and checked aggregate publisher; and
- the exact run matrix, family/model ids, attempts, budgets, and order.

The content digest joins the task brief, system prompt additions, tools,
machine image, toolchains, public pack, visible suite, evaluator, hidden-suite
commitments, day-two commitments, run schema, and scoring rules. Changing any
item after observing an official result creates a new experiment revision; it
does not silently repair the current one.

### Visible suite V

V teaches the ordinary contract and gives candidates a complete local loop:

- generation and boot;
- schema/index admission;
- query and mutation happy paths;
- conflict refusal;
- live initial snapshot, update, and teardown;
- reset/seed determinism;
- stale-artifact and unsupported-capability refusals;
- readiness, capability, and inspection output; and
- a small malformed-input set.

Every normative clause is disclosed. Hidden tests instantiate disclosed rules;
they never introduce secret product requirements.

### Holdout A and the equal remediation round

Holdout A emphasizes compositions and edge values absent from V:

- interleaved writers and stale read sets;
- crash/reopen around prepare, commit, journal visibility, and live delivery;
- multiple subscriptions and connection teardown;
- malformed and oversized payloads;
- artifact graph changes, partial generations, and stale readiness;
- query-membership entry/exit and delta/replace fallback;
- route and admin-authority negatives;
- runtime capability escape attempts; and
- exact diagnostic/capability honesty.

After initial candidate freeze, Holdout A runs once. Each candidate receives
the same **category-level** result packet: failed clause ids, severity, and
failure class, but not hidden input values, expected outputs, test source, or
incumbent result. Every candidate receives the same 24-hour / 20-million-token
remediation allowance. The remediated cut then freezes.

This round measures the ability to repair from structured evidence while
preserving a still-untouched final holdout.

### Holdout B

Holdout B is the terminal behavioral oracle. It contains independently
generated duals of V/A cases, new legal values, reordered event schedules,
cross-product axis cells, and adversarial sequences. It is never disclosed or
used for candidate repair in this experiment revision.

The evaluator reports by clause and semantic family, not merely test count, so
one heavily parameterized easy rule cannot outweigh one failed atomicity or
authority invariant.

### Execute-only incumbent oracle

Candidates may send at most 25,000 logged requests through a broker that:

- exposes only documented K1 operations;
- resets to named deterministic fixtures;
- returns sanitized response bytes and declared observations;
- does not reveal source paths, logs outside the public diagnostic contract,
  database files, package artifacts, test names, timing-sensitive secrets, or
  the incumbent binary;
- marks known-deviation operations with a public `spec-controls` warning rather
  than inviting bug-for-bug compatibility; and
- records every query for later specification-gap analysis.

All candidates receive the same quota. Oracle exploration is optional. Hard
coding observed examples is checked through holdout duals and the generalization
scan.

### Holistic review

After behavioral evaluation, admissible candidates are anonymized and reviewed
by at least two fresh model families that did not author that candidate. The
reviewers receive the public pack, candidate source, machine records, test
results, and architecture memo, but not model identity or ranking.

The rubric covers:

- one identifiable owner for each state transition and commit boundary;
- dependency direction and absence of cyclic domain policy;
- local reasoning required to change a contract;
- error handling, bounds, and cleanup on every edge;
- test quality and correspondence to normative clauses;
- documentation and generated artifact legibility;
- unsafe-code and dependency posture;
- duplication and accidental dialects; and
- whether the design is likely to survive K2 rather than merely fit K1.

A `MATERIAL` security, durability, or architecture finding blocks winner status
until the equal remediation protocol or a later experiment revision resolves
it. Review prose does not override a failing hard test.

### Performance and resource protocol

The incumbent and every admissible candidate run on the same pinned machine
class with counterbalanced order and at least five repetitions. Record:

- cold and warm boot/readiness;
- query p50/p95 and throughput;
- single-writer mutation throughput and p95;
- affected/unaffected live fan-out cost;
- peak and settled RSS;
- idle CPU and disk writes over the LLP 0035-style window;
- database growth per fixed workload;
- clean and incremental compile/test time; and
- binary/artifact sizes.

The experiment does not collapse this into one performance number. Any
preregistered safety/resource ceiling is hard; other metrics carry direction,
effect size, variance, and workload scope.

### Day-two change tasks

Three tasks are committed privately before official runs, one from each class:

1. **Semantic extension:** add one bounded portable query or mutation feature
   without weakening existing refusals.
2. **Protocol evolution:** add one backward-compatible wire/capability member
   and prove mixed-version behavior.
3. **Target separation:** introduce a constrained target profile that shares
   contracts while honestly refusing one K1 behavior.

The exact tasks remain sealed until terminal K1 cuts freeze. Each candidate and
the incumbent receive the same task, public rationale, machine, tools, and
24-hour / 20-million-token allowance. Each run produces a semantic diff,
affected-clause set, touched-owner set, new tests, active time, model tokens,
and terminal proof receipt.

Day-two scoring rewards correct evidence-bearing change, not raw edit speed.
Failure or weakened proof is a capability outcome, not a timeout value silently
inserted into an efficiency ratio.

## Candidate run protocol

### Model-family selection

E0 selects the strongest currently available coding agent from at least three
independent model families. Selection uses public current evidence and a generic
non-Snapback environment check; it may not use a preliminary Snapback result.
The exact model/build, scaffold, effort, tool configuration, and provider are
frozen before the calibration run.

The recommended initial matrix is three families × three official attempts:

| Family | Attempts | Role |
| --- | ---: | --- |
| A | A1, A2, A3 | official |
| B | B1, B2, B3 | official |
| C | C1, C2, C3 | official |

One separate calibration attempt uses a fourth attempt id or a non-competing
family. Its output is discarded and never enters the official score.

If a provider exposes no deterministic seed, attempts are still distinct and
all results are reported. An infrastructure failure may restart only under the
frozen retry rule and retains both the failed and replacement records.

### Environment and source blindness

Each attempt begins in a fresh isolated repository containing only:

- the public spec pack and visible suite;
- a minimal empty project scaffold;
- frozen toolchains and dependency mirror;
- documented prebuilt Ibex ABI artifacts;
- the oracle client and request budget; and
- the run recorder.

The environment has no Snapback Git history, source, npm packages, generated
artifacts outside the public pack, incumbent tests, issue corpus, diaries,
review artifacts, sibling checkouts, credentials, or unrestricted network.
Network is disabled after provisioning except for the brokered model/tool
channel and incumbent oracle. Filesystem and process monitors fail the run on
attempted access outside the workspace and declared toolchain roots.

The candidate may create any new implementation, tests, docs, and build tools
inside the workspace. It may not wrap, invoke, or ship the incumbent oracle.
Final evaluation runs with oracle access removed.

### Prompt and clarification discipline

Every family receives semantically identical instructions:

- build the complete K1 profile, not a demo;
- keep working until the budget or explicit submission;
- run and expand the visible suite;
- write an architecture and nonclaim memo;
- do not infer undocumented product requirements from the oracle;
- surface specification ambiguities through the typed ambiguity channel; and
- do not claim success from partial or skipped evidence.

An ambiguity request can receive only:

1. a pointer to an existing public clause;
2. a correction of an instrument defect, broadcast to every still-running
   attempt and recorded as an experiment revision; or
3. `unresolved`, leaving the implementer to state and test its interpretation.

No private human coaching, candidate-specific hint, or result-aware requirement
change is allowed.

### Recommended budget

Each official initial attempt receives:

- 96 hours elapsed wall time;
- at most 150 million provider-metered input + output tokens;
- at most USD 750 of model inference at the frozen kickoff price; and
- the common machine quota.

The first limit reached ends the run. Holdout-A remediation and each day-two
task separately receive 24 hours, 20 million tokens, and USD 150. Provider token
accounting is not treated as cross-family efficiency evidence unless the
provider fields are directly comparable; spend, wall time, and within-family
token counts remain separately reported.

The run stops early only when the agent explicitly submits, the environment
detects a safety/source-blindness violation, or eight hours pass with no file,
test, diagnostic, or design-state change and a read-only liveness check confirms
no active work. A low interim score alone is not an early-stop rule.

### Run record

Every attempt produces a schema-valid machine record containing:

- experiment and artifact digests;
- model/provider/scaffold/effort identity;
- attempt id and available seeds;
- toolchain, dependency, OS, hardware, and cache state;
- start/end, active phase times, tokens, and spend;
- semantic action trace per LLP 0197;
- oracle queries and ambiguity requests;
- checkpoints and test receipts;
- final source/tree digest and architecture memo;
- visible, holdout A, remediation, holdout B, security, performance, holistic,
  and day-two results; and
- explicit missing evidence and nonclaims.

Raw transcripts and sensitive originals follow LLP 0197's private/public
boundary. Published records are recomputed from machine records; they are not
hand-summarized as evidence.

## Scoring and decision rules

### Hard admissibility gates

A candidate is inadmissible if any of the following is true:

1. a K1 load-bearing clause for server authority, atomic commit, read-set
   validation, commit visibility, crash recovery, artifact activation,
   route/admin authority, runtime capability isolation, or capability honesty
   fails;
2. any Critical or High security/correctness finding remains open;
3. any selected test is skipped, weakened, special-cased, or satisfied by
   invoking/hard-coding the oracle;
4. source-blindness or dependency provenance cannot be verified;
5. clean build, deterministic reset, or fresh-machine boot cannot be
   reproduced;
6. candidate tests do not cover every normative clause assigned to the
   implementation; or
7. the final capability/architecture memo makes a material claim contradicted
   by machine evidence.

An inadmissible candidate remains in the published denominator and defect
analysis. It cannot win through performance, small size, or a weighted score.

### Weighted comparison among admissible candidates

| Dimension | Weight | Primary evidence |
| --- | ---: | --- |
| Semantic completeness and exact behavior | 30 | V, A, B by clause family |
| Durability, concurrency, and recovery | 15 | fault schedule, reopen, interleavings |
| Security and capability boundaries | 15 | adversarial suite + blind review |
| Maintainability and day-two change | 20 | three change tasks + owner/diff evidence |
| Performance and resource behavior | 10 | repeated counterbalanced workloads |
| Agent DX, diagnostics, and inspectability | 5 | refusal/repair rubric + machine surfaces |
| Build reproducibility and dependency posture | 5 | clean machines, locks, provenance |

Scores are reported with component results, variance, and reviewer disagreement.
No aggregate may hide a failed semantic family. The incumbent is scored on the
same K1 surface; excluded incumbent features earn no bonus.

### “Materially better” threshold

A candidate may be called a **K1 experimental winner** only when it:

1. passes every hard admissibility gate;
2. beats the incumbent's total score by at least 10 points out of 100;
3. has no scored performance/resource regression greater than 20% without an
   accepted, measured tradeoff;
4. improves at least one of maintainability/day-two cost, latency/throughput,
   or settled resource use by at least 25% on the preregistered measure;
5. completes at least two of three day-two tasks with full proof and with lower
   combined active time + within-family tokens than the incumbent-agent control;
6. receives no unresolved `MATERIAL` concern from either anonymous holistic
   reviewer; and
7. reproduces its terminal K1 result on a fresh machine and, for the winner
   only, the secondary supported host architecture selected in E0.

If no candidate clears this threshold, the result is “no K1 winner.” The plan
does not select the least-bad implementation. If several clear it within the
instrument's measurement uncertainty, report co-winners or “no unique winner”;
do not manufacture a ranking from decimal noise.

This threshold supports an experimental K1 claim only. It is not evidence that
the candidate is a better whole Snapback implementation.

## Execution phases

### E0 — Commission, snapshot, and preregistration

**Work**

1. Select incumbent commit `I`, qualified Ibex/runtime artifacts, host platforms,
   and K1 surface.
2. Record the current corpus, guide, schemas, issues, diaries, and proof
   inventories as distillation inputs.
3. Select exact candidate families/models, machines, budgets, order, attempt
   ids, cache posture, and disclosure posture.
4. Create the private experiment repository/store and source-access controls.
5. Freeze the run-record schema and conflict-of-interest roles.

**Exit**

- One content-addressed commission record exists before any model-specific
  Snapback result.
- The author confirms that the experiment is research-only under LLP 0225.
- No hidden evaluator author is also an official candidate implementer after
  the evaluator freeze.

### E1 — Distill the specification pack

**Work**

1. Extract the root constitution, K1 capabilities, state machines, exact
   shapes, failure semantics, limits, and nonclaims using the truth hierarchy.
2. Read implementation, tests, closed defects, diaries, and review artifacts
   to find as-built details and missing specifications.
3. Build the private traceability matrix and adjudication ledger.
4. Generate candidate-facing clauses without implementation paths or accidental
   internal architecture.
5. Validate every contract fixture against its authority and every clause
   against at least one planned witness.

**Exit**

- No `inferred` clause is normative.
- Every K1 checklist item maps to clauses and witnesses.
- Every known incumbent deviation has a disposition.
- The public pack passes link, schema, internal-consistency, vocabulary, and
  size checks.

### E2 — Independent specification attack

At least two fresh reviewers from different model families independently read
only the public pack and attempt to:

- derive all state transitions and authority decisions;
- generate ambiguous edge cases;
- identify contradictory clauses, missing framing, undefined ordering, and
  unbounded behavior;
- predict two conforming implementations that would observably disagree; and
- write a minimal implementation plan without reading the incumbent.

The orchestrator adjudicates findings through the private map. Material fixes
return to E1. Review ends only when both reviewers mark the pack implementable
or the author explicitly accepts named ambiguity for the experiment.

**Exit**

- Review artifacts and dispositions are retained.
- The public pack revision to be evaluated is frozen.
- Any unresolved ambiguity is an explicit clause with an allowed interpretation
  set, not hidden evaluator discretion.

### E3 — Build and validate the evaluator

**Work**

1. Partition visible V, holdout A, and holdout B by semantic family before
   generating dual values.
2. Build the oracle broker, security harness, fault schedule, performance
   runner, machine records, and checked publisher.
3. Score the incumbent against the desired spec, preserving known corrected
   deviations rather than changing expected results to make it green.
4. Mutation-test the evaluator: deliberately broken reference variants must be
   caught for atomicity, conflict validation, live membership exit, teardown,
   stale activation, admin authority, malformed input, and capability honesty.
5. Seal A/B and day-two tasks with private keyed commitments.

**Exit**

- The incumbent score and all known deviations are reproducible.
- Each load-bearing clause has at least one independent negative or fault
  witness.
- No hidden test encodes an undisclosed requirement.
- The checked publisher recomputes the complete blank run matrix.

### E4 — Discarded calibration run

Run one source-blind candidate through the complete protocol, including oracle,
V, A-style remediation, security, performance, and one disposable change task.
This run exists to find instrument defects, impossible environment assumptions,
and clarification-channel failures. It is not eligible for ranking, reuse, or
promotion.

Any material instrument change creates the final frozen experiment revision.
After that freeze, official results cannot repair the instrument in place.

**Exit**

- A clean candidate can build, invoke the oracle, run V, submit, and produce a
  valid record.
- Source blindness and budget accounting are demonstrated.
- Calibration code is destroyed or archived outside the official candidate
  pool with its ineligible status explicit.

### E5 — Official K1 tournament

Run the nine official attempts under the counterbalanced machine/order schedule.
Each attempt proceeds through initial build, visible proof, initial freeze,
Holdout A, equal remediation, and final freeze. Operators intervene only for
frozen infrastructure rules. Status monitoring records facts but supplies no
coaching.

**Exit**

- Every preregistered attempt has a terminal machine record: success, failure,
  budget exhaustion, explicit submission, safety stop, or infrastructure
  disposition.
- No attempt is dropped or replaced because of quality.
- Final source digests are sealed before Holdout B.

### E6 — Terminal evaluation

1. Run Holdout B with oracle access removed.
2. Run security/adversarial and holistic reviews.
3. Run repeated performance/resource measurements in counterbalanced order.
4. Run the three day-two tasks against admissible candidates and the incumbent
   control.
5. Reproduce finalists on fresh machines.
6. Compute hard-gate verdicts and weighted results through the checked publisher.

Model/provider identity remains blinded to holistic reviewers and, where
practical, to the author until their verdicts are recorded.

**Exit**

- The result is one of: no admissible candidate; admissible but no material
  winner; one K1 experimental winner; or multiple indistinguishable winners.
- Every conclusion traces to machine records and named review artifacts.

### E7 — Synthesis and disposition

Produce one Research LLP and a private/public evidence packet covering:

- specification ambiguities and missing contracts;
- incumbent defects and accidental behavior;
- candidate defect clusters by family and phase;
- architectural convergence/divergence;
- oracle queries that reveal weak documentation;
- evaluator blind spots and mutation-test results;
- cost and time distributions;
- K1 winner/no-winner verdict; and
- recommended product, LLP, guide, test, and modularization follow-ups.

Repository-scoped findings become deduplicated filesystem tickets. Security
findings remain private until fixed or explicitly cleared for disclosure.
Generally useful spec/test corrections may land independently of candidate
adoption.

**Exit**

- The experiment can be understood without private transcript reconstruction.
- Every material follow-up has an owner or explicit no-action disposition.
- Candidate workspaces remain unsupported research artifacts.

### E8 — Optional scope expansion

Expansion is not automatic. The author may commission K2 only when:

- at least two official attempts were admissible, demonstrating repeatability
  beyond one lucky run;
- at least one K1 experimental winner cleared the material threshold;
- the spec/evaluator defect rate fell below the preregistered E7 threshold;
- no unresolved Critical/High K1 finding remains; and
- the estimated K2 budget and target scope receive a new frozen plan amendment.

Recommended expansion ladder:

| Profile | Added scope | Still excluded |
| --- | --- | --- |
| K1 | local transaction/query/live kernel | auth, clients, assets, hosted |
| K2 | sessions auth, authorization invalidation, headless protocol client, offline outbox/retention | assets, jobs, hosted |
| K3 | complete supported local product, first-party clients, assets/jobs/ephemeral | Cloudflare and hosted product |
| K4 | Cloudflare contract twin and cross-target conformance | production successor decision |
| K5 | whole-product successor qualification | nothing; requires new Decision |

Each profile gets its own distillation, holdouts, calibration, official run
matrix, and winner threshold. A K1 implementation does not accrete K2 features
informally between experiments.

## Contamination and generalization controls

Because Snapback source and discussions may eventually enter model training or
web search, source blindness is necessary but not sufficient. The program:

- disables web and repository access during runs;
- records whether each selected model's training cutoff could include the
  incumbent snapshot;
- scans candidate source for long normalized token/AST matches against the
  incumbent and separately against common dependencies;
- asks candidates after submission to describe any prior Snapback knowledge,
  treating the answer as evidence rather than proof;
- uses holdout duals that cannot be passed by memorizing visible examples;
- includes a sealed day-two semantic extension authored after the selected
  models' documented cutoff where feasible; and
- reports suspected contamination without silently discarding the attempt.

Similarity is not automatic disqualification: constrained Rust/SQLite code can
converge naturally. A candidate becomes inadmissible when provenance evidence
shows source access, copied non-public structure, or behavior dependent on
incumbent artifacts.

## Safety and disclosure

- Candidate services bind only to isolated loopback/network namespaces and use
  synthetic data.
- No real credentials, external services, production databases, or public
  deployment enter the experiment.
- Runtime escape, path traversal, or host compromise stops the affected run and
  triggers a safety review before other runs continue.
- Newly discovered incumbent vulnerabilities follow a private fix-first path;
  publication is delayed until the owner confirms disclosure is safe.
- Raw model transcripts, tool arguments, private test inputs, holdouts, machine
  identifiers, and sensitive originals remain in the LLP 0197 private store.
- Candidate source may be published only after license/provenance scanning and
  a human disclosure review. Public source is labeled experimental and
  unsupported.

## Cost and schedule

Recommended wall-clock plan, assuming parallel isolated machines:

| Phase | Target duration | Main cost |
| --- | ---: | --- |
| E0 | 1–2 days | commissioning and environment freeze |
| E1 | 3–5 days | corpus/code distillation and traceability |
| E2 | 2–3 days | two independent specification attacks |
| E3 | 4–7 days | evaluator, oracle, mutation tests, incumbent baseline |
| E4 | 2–4 days | discarded end-to-end calibration |
| E5 | up to 4 days elapsed | nine parallel 96-hour candidate caps |
| E6 | 3–5 days | hidden tests, review, performance, day-two tasks |
| E7 | 2–3 days | synthesis, tickets, and publication packet |

The first complete K1 cycle therefore targets roughly three calendar weeks.
The qualifying candidate inference ceiling is USD 6,750 (nine × USD 750), plus
calibration, remediation, day-two, reviewer, and infrastructure costs. E0 must
record a total authorization ceiling before work begins. Crossing it requires
an author amendment, never an operator assumption.

The main repository continues moving during the experiment. All evidence binds
the frozen incumbent/spec/evaluator snapshot under LLP 0189's scoped-snapshot
model; new `main` commits neither invalidate the experiment nor silently enter
its claims.

## Stop rules

Stop the current K1 revision and publish/synthesize what was learned when any
of these occurs:

1. **Specification stop:** E2 finds a material product decision that no
   accepted source resolves and the author declines or cannot yet adjudicate it.
2. **Evaluator stop:** mutation testing cannot independently catch one or more
   load-bearing violations without inspecting candidate internals.
3. **Isolation stop:** source blindness, hidden-suite custody, or provider
   accounting cannot be credibly enforced.
4. **Calibration stop:** two discarded calibration attempts fail to reach a
   working tool/build/test loop because of the instrument rather than candidate
   capability.
5. **Cost stop:** the author-set experiment ceiling is reached.
6. **Safety stop:** a runtime or infrastructure escape makes continued runs
   unsafe.
7. **Dry-well stop:** after all official attempts, no candidate boots and
   passes the complete visible happy path. Do not expand budgets post hoc; use
   the records to decide whether a new experiment revision is justified.
8. **No-winner stop:** candidates are interesting but none clears hard gates or
   the material-win threshold. Do not select one merely because a rewrite was
   hoped for.

Stopping is a valid Research outcome, not a blocked Plan. Candidate output is
never allowed to create commitment through sunk cost.

## Possible outcomes and authorized follow-up

### Outcome A — the specification is not independently implementable

Repair LLPs, schemas, guide pages, and conformance fixtures. The experiment has
shown that the project's design record is not yet a sufficient product genome.
Do not commission more candidate compute until the spec attack passes.

### Outcome B — no admissible implementation

Publish the defect clusters and capability boundary. Improve the evaluator and
use candidate failures to prioritize product/document work. Continue LLP 0225's
incumbent modularization.

### Outcome C — better architectural fragments, no K1 winner

Write scoped extraction proposals for the useful ownership, transaction,
runtime, or diagnostic patterns. Adopt them only through strangler-style
changes behind the incumbent façade with current proofs. Candidate code is
evidence and a prototype, not a parallel core.

### Outcome D — a K1 experimental winner

Preserve the candidate and its full evidence packet. Commission either:

- a bounded component-adoption Decision compatible with LLP 0225; or
- K2 under E8's expansion gate.

Do not call it a better Snapback implementation; call it a better K1
experimental implementation.

### Outcome E — a later K5 successor

Only a K5 result can support a whole-product comparison. Even then, migration,
compatibility, operational custody, security response, ecosystem continuity,
and recoverability need a separate author-ratified Decision. That Decision must
explicitly amend or supersede LLP 0225 before any parallel production core or
cutover begins.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The distiller copies incumbent architecture into the “spec” | Withhold private traceability; ban internal names/paths; reviewers search for implementation prescription not required by behavior. |
| The spec silently promotes Draft aspirations | Truth hierarchy and provenance validation reject `draft-candidate` clauses. |
| Candidates reproduce known bugs through the oracle | Desired/incumbent disposition table; `spec-controls` warning; corrected evaluator cases. |
| Hidden tests introduce secret requirements | Every hidden case maps to a disclosed clause; independent audit before sealing. |
| Models overfit visible/oracle examples | Dual holdouts, request quota, generalization scan, oracle removed for final evaluation. |
| One lucky run becomes a capability claim | `N = 3` per family, all attempts reported, E8 requires two admissible attempts. |
| Tests reward brittle code | Holistic review, security review, performance, and sealed day-two changes. |
| Weighted scoring hides catastrophic behavior | Hard gates precede scoring; semantic-family results remain visible. |
| Model identity biases judgment | Anonymous candidates and cross-family reviewers until verdicts freeze. |
| The experiment starves product work | Fixed budget, external workspaces, LLP 0189 snapshot, LLP 0232 fast-moving-main independence. |
| A promising candidate causes a premature rewrite | LLP 0225 remains controlling; no candidate lands without a new scoped Decision. |
| Candidate source leaks secrets or proprietary transcript data | Private store, provenance/license scan, redaction, human publication review. |

## Acceptance criteria for this Plan

This Plan is ready to move from Draft only when the author has ruled:

1. that a research-only K1 experiment is compatible with the intended reading
   of LLP 0225, or supplied the necessary narrow amendment;
2. that K1's included/excluded surface is the right first test;
3. the exact total budget ceiling and whether USD/token caps above stand;
4. the minimum number of independent families and `N = 3` attempt count;
5. who holds the hidden evaluator, security disclosure, and publication roles;
6. whether candidate source/results may eventually be public; and
7. whether E8's two-admissible-attempt expansion gate is sufficiently strict.

Implementation of the Plan is complete when:

- E0–E7 have terminal records;
- every preregistered attempt is accounted for;
- the checked publisher reproduces the outcome;
- the Research synthesis and issue dispositions land;
- private/public evidence custody is validated; and
- candidate workspaces are archived or destroyed according to the author ruling
  without becoming an accidental supported implementation.

## Open questions

1. Should the official tournament use three or four model families if a fourth
   family is competitive at E0?
2. Is 150,000 tokens the right candidate-facing prose ceiling, or should the
   first-load pack be smaller with more retrieval-indexed appendices?
3. Should K1 require exact current wire compatibility, or a smaller
   language-neutral semantic protocol with an adapter used only by the
   evaluator?
4. Which Ibex artifacts and host-ABI documentation can be exposed without
   leaking Snapback implementation structure?
5. Does the 25,000-request oracle budget permit useful exploration without
   enabling brute-force transcription?
6. Which current K1 defects should score as corrected desired behavior, and
   which compatibility accidents must remain parity requirements?
7. Should the incumbent day-two control be implemented by the same model family
   as each candidate (best causal comparison) or by one frozen neutral family
   (lower total cost)?
8. What objective mutation-test threshold is sufficient to close E3?
9. Should candidate code remain private until after incumbent vulnerabilities
   and contamination analysis are resolved?
10. If a candidate wins K1 but its internal design cannot plausibly extend to
    sessions/auth or multi-target execution, should that fail winner status or
    only block E8?

## Status

Draft. This document proposes a bounded, preregistered experiment and requires
the author decisions above before execution. It creates no implementation,
publication, migration, replacement, or cutover authority.
