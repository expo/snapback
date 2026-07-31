# LLP 0137: React-web improvement sweep and deferred backend championship

**Type:** Plan
**Status:** Draft
**Systems:** Competitive evaluation, Demo applications, React, React/Expo, Exact Native, Developer experience, Data modeling, Realtime, Offline sync, Auth, Assets, Search, Actions, Scheduled work, Deployment, Operations, Testing, Documentation
**Author:** Charlie Cheever / Codex / Claude
**Date:** 2026-07-31
**Revised:** 2026-07-31 (v3 purpose inversion per Charlie's direction: the program now exists to surface what would make Snapback better, not to prove Snapback is better — that proof is deferred until the improvement well runs dry. Phase 1 is a Snapback-first improvement sweep over all six contracts as an external npm consumer, with a mid-program fix loop, frozen-evidence-first competitor referencing, and demand-driven fresh probes; the symmetric championship — core/extension matrix, composite, ranking controls — is preserved compactly as deferred Phase 2 behind a dry-well trigger. Ranking-fairness controls that obstruct improvement, chiefly the single frozen Snapback revision and atomic rounds, move to Phase 2; honesty controls stay). 2026-07-31 (v2 efficiency restructure: sixteen-arm symmetric core over A1–A4 plus five extension arms; contract lineage to LLP 0102 with a zero-new-arm longitudinal comparison; atomic per-contract rounds; Track B baseline + checkpoint; former open questions 1–5 resolved). 2026-07-31 (refine pass: challenger gate unified; composite comparability scoped; Track B eligibility rule; cross-references verified). 2026-07-31 (initial draft: a four-backend React-web championship, a separately scored Expo validation, a Snapback-only Exact Native graduation exercise, and selective specialist challengers, all gated on public-package consumption)
**Related:** LLP 0000, LLP 0010, LLP 0015, LLP 0016, LLP 0035, LLP 0041, LLP 0044, LLP 0064, LLP 0074, LLP 0093, LLP 0102, LLP 0103, LLP 0105, LLP 0107, LLP 0114, LLP 0115, LLP 0129, LLP 0130, LLP 0132, LLP 0133, LLP 0135, LLP 0136, Diary 0027–0039

## Summary

The purpose of this program is to surface everything that would make Snapback
better, using real applications and the strongest competitors as reference
points. Proving that Snapback is better comes later: a competitive ranking is
only worth running when the improvement backlog has thinned enough that its
result would outlast it.

The program therefore runs in two phases plus two platform tracks:

1. **Phase 1 — improvement sweep (now).** Snapback builds all six application
   contracts as an external npm consumer, in ascending ambition, filing every
   gap, friction, and defect as an owned finding with an acceptance witness.
   Fixes may land between arms — the sweep exists to feed the fix loop, not to
   protect a score. Competitor comparison defaults to the frozen LLP 0102/0115
   diary evidence; a fresh competitor probe runs only when it would change
   what Snapback builds.
2. **Phase 2 — backend championship (deferred).** The symmetric four-backend
   matrix, historical composite, and ranking-grade controls are preserved in
   this document and run only after the dry-well trigger fires. No backend
   ranking is claimed before then.

**Track B (Expo)** applies the same sweep-first logic on mobile: Snapback
implements A1 and A4 on Expo with independent iOS and Android receipts to
surface mobile-specific gaps, with Firebase available as the reference probe.
**Track C (Exact)** asks whether one frozen contract graduates across
Contract/web, Exact Native/iOS, and Exact Native/Android; it was always an
improvement instrument and is unchanged.

The six contracts carry explicit lineage to the LLP 0102 applications, so the
sweep also answers "has Snapback measurably improved since the 0102 epoch?"
from frozen diary evidence, at no new arm cost.

Planning and fixture work may begin immediately. No Snapback arm is timed or
diaried until the terminal `@expo/snapback-*` package closure is publicly
installable and one clean external smoke arm proves the sweep can consume it
without a Snapback checkout (G1) — installing Snapback the way a stranger
would is itself the first gap-surfacing exercise.

## Why this is a successor rather than an LLP 0102 revision

LLP 0102 owns the completed seven-backend, five-app bakeoff and its frozen
evidence. That program established a broad market map, a reusable evidence
discipline, and a historical ranking. Amending it into a new experiment would
blur the versions, assistance policy, package boundary, and result that its
reports preserve. This Plan reuses 0102's frozen evidence as its default
competitor reference and inherits its rules for provider-native
implementations, Stop-class defects, target isolation, immutable diaries, and
measurement records. Where this Plan differs, this document controls
prospectively.

LLP 0115 remains the owner of the Snapback × Convex parity rerun and its
course-correction exits. LLP 0129 remains the owner of Snapback's local-first
program. This Plan consumes their shipped state and measurements and feeds its
findings into their backlogs; it does not change their completion criteria.

## Research questions

Phase 1 asks, in priority order:

- What does a competent external builder hit — in gaps, friction, defects,
  missing table stakes, and documentation failures — when building six real
  React web applications on public-package Snapback today?
- For each finding: is it a defect, a missing capability, an experience
  problem, a documentation failure, an operational gap, a maturity gap, or a
  deliberate non-goal — and what is the smallest coherent Snapback-native fix
  and the acceptance witness that would prove it?
- Where Snapback's outcome is worse or unclear, what does the strongest
  competitor's concrete outcome look like on the same product fact — from
  frozen 0102/0115 evidence where it exists, from a fresh probe where it
  doesn't?
- Has Snapback measurably improved since the LLP 0102 epoch on the facts the
  lineage contracts preserve?
- Are Snapback's differentiators valuable in normal applications, or visible
  only in adversarial acceptance tests — and which must not regress while the
  gaps close?
- Does the picture change on Expo, and can one contract graduate across the
  Exact Native carriers without claim inflation?

Phase 2, when triggered, asks the deferred question:

> After the improvement program, which backend would a competent builder
> choose today for a new React web application, and why?

## Program boundaries

### Improvement evidence, not ranking evidence

Phase 1 produces findings, diaries, and a gap ledger. It produces no backend
ranking, no composite, and no "Snapback wins/loses" claims — its Snapback
revision moves as fixes land, so its arms are not rank-comparable by design.
Phase 2 evidence must be produced fresh under Phase 2's controls; Phase 1
arms and probes are never re-labeled as championship arms.

The platform tracks stay separate for the same reasons as before: Expo
lifecycle, native auth, and packaging are not backend-only properties; Exact
Native is a Snapback carrier, not another backend; and an iOS pass does not
establish Android behavior, or vice versa, under LLP 0064.

### Comprehensive backends versus composable layers

The reference providers are products that plausibly supply the ordinary
application backend as one coherent offering. Databases and sync layers such
as Neon, PlanetScale, ElectricSQL, PowerSync, Zero, LiveStore, or Turso are
not treated as though they independently supplied auth, functions, files,
scheduling, effects, deployment, and operations. A future composable-stack
study is its own program, not an amendment to this one by implication.

## The six application contracts

The contracts share observable product facts, not a backend abstraction. Each
uses a neutral React/TypeScript shell and the provider's idiomatic schema,
functions, policies, subscriptions, clients, and deployment path.

#### A1. Offline field notebook

Exercises the local-first floor:

- authenticated team workspaces and outsider denial;
- structured records, assignments, ordering, due dates, and attachments;
- cold browser restart with the backend unreachable;
- retained protected reads with honest freshness state;
- durable queued create and update operations across restart;
- concurrent conflicting edits with a visible deterministic outcome;
- reconnect settlement without duplication;
- authorization loss and logout retirement of protected local state; and
- deterministic seed, export, and cleanup.

#### A2. Group chat and presence

Exercises append-heavy realtime and transient state:

- public and private channels with membership revocation;
- stable cursor history and deterministic message ordering;
- authoritative realtime delivery to a second client;
- typing and presence through a genuinely ephemeral path where supported;
- unread state across two clients;
- disconnect, reconnect, and resnapshot without duplication;
- retained history where supported;
- concurrent sends and idempotent retry; and
- zero durable amplification for presence where claimed.

#### A3. Collaborative issue and planning board

Exercises relational and React composition:

- organizations, teams, projects, issues, labels, comments, and activity;
- owner, member, guest, and outsider policy;
- indexed filters, ranges, ordering, pagination, and full-text search;
- issue detail composed from related records and bounded aggregates;
- optimistic status, assignee, priority, and board-position updates;
- concurrent moves and semantic conflict handling;
- live comments, activity, counts, and search where claimed;
- one schema evolution over production-shaped seed data; and
- at least one registered multi-query React surface rather than a headless-only
  acceptance client.

#### A4. Event and invitation application

Exercises broad product services:

- public preview with private host controls;
- host, cohost, guest, and outsider authority;
- invitation and deep-link entry;
- RSVP plus-one capacity enforced under contention;
- live wall posts, guest counts, and presence;
- authenticated image upload, rendition, delivery, deletion, and revocation;
- scheduled reminder with an inspectable, idempotent delivery attempt;
- one external notification effect with retry and ambiguous-outcome handling;
  and
- deterministic cleanup of data, files, schedules, identities, and config.

#### A5. Collaborative AI research room

Exercises files, retrieval, and long-running effects:

- authorized source-file upload, metadata, download, and deletion;
- keyword and vector retrieval with outsider denial;
- streamed durable progress before terminal completion;
- answer citations to source records;
- cancellation fencing against late durable patches;
- idempotent retry without duplicate questions or answers;
- distinct complete, failed, cancelled, timed-out, and ambiguous outcomes;
- a second member observing progress live; and
- scheduled external refresh with server-side secret custody.

#### A6. Operations and workflow ledger

Exercises bounded composition and background work:

- customers, jobs, steps, assignees, status, sequence numbers, and activity;
- transactional allocation of a human-visible sequence;
- bounded child lists and aggregate dashboard counts;
- one-off transactional scheduling and recurring maintenance;
- claim, retry, timeout, cancellation, and append-only attempt receipts;
- idempotent external dispatch with inspectable settlement;
- concurrent claims and ownership fencing;
- live operational dashboard with range filters; and
- export, restore, and cleanup evidence.

### Contract lineage and the longitudinal baseline

Four contracts descend from LLP 0102 applications; two are new shapes:

| Contract | Lineage |
| --- | --- |
| A1 Offline field notebook | new — the LLP 0129 local-first floor had no 0102 counterpart |
| A2 Group chat and presence | 0102 chat application (Diary 0028; Snapback rerun Diary 0034) |
| A3 Issue and planning board | 0102 Linear-shaped application (Diary 0029) |
| A4 Event and invitation | 0102 Partiful-shaped application (Diary 0030) |
| A5 AI research room | 0102 research-room application (Diary 0031) |
| A6 Operations ledger | new — sequence allocation, claims, and settlement receipts (LLP 0133, LLP 0135) had no 0102 counterpart |

The sweep report must include a longitudinal Snapback comparison: for every
product fact a lineage contract shares with its 0102 ancestor, compare the new
Snapback arm's outcome, authoring cost, and friction against the frozen Diary
0027–0039 evidence. No historical arm is rerun. This is also the cheapest
detector of regressions the recent productization work may have introduced.

## Phase 1 — the improvement sweep

### Snapback arms

Snapback implements all six contracts from a clean external repository against
the public `@expo/snapback-*` closure, in ascending ambition: A2, A1, A3, A4,
A5, A6. The order is chosen for learning, not fairness — early cheap arms
shake out harness and packaging findings before the deep arms spend budget on
them.

Rules:

- **External consumer posture.** No Snapback checkout, no repository-relative
  imports, no knowledge unavailable to a public npm user; the guide and public
  docs are the only sanctioned documentation. Every place the builder is
  forced to break this posture is itself a finding.
- **Fix loop.** Findings are filed continuously as filesystem tickets (or
  LLPs, per the synthesis section's ownership rules). Fixes may land between
  arms; each arm's diary records the exact package versions it ran against. An
  arm is not restarted because a fix landed — a later re-verification of the
  affected acceptance facts appends a dated entry instead.
- **Budgets as instruments.** LLP 0102's ceilings — four active hours and 200
  tool calls for A2, eight hours and 400 calls for the deep arms — are
  recorded and act as circuit breakers, but exceeding one is a finding to
  file (with what consumed the time), not a score to protect. A blocked arm
  records its blocker and moves on.
- **Differentiator watch.** Each arm also records what Snapback did *better*
  than the reference evidence and what must not regress; the sweep protects
  these while the gaps close.

### Competitor references and probes

The default competitor reference is frozen evidence: the LLP 0102 diaries and
reports, the LLP 0115 rerun evidence, and current official provider
documentation. That evidence already documents Convex, Supabase, and Firebase
outcomes on the four lineage shapes.

A **fresh competitor probe** — a provider-native implementation of one
contract, or a bounded slice of one — is justified only when:

1. the finding would change what Snapback builds, and frozen evidence cannot
   settle what "good" looks like on the product fact in question;
2. no frozen evidence covers the dimension (chiefly A1's local-first floor
   and A6's sequence/claims shape, plus current-generation vector and file
   pipelines on A5); or
3. the provider's recommended path has materially changed since 0102 froze.

Expected strongest-fit probes, pre-declared as guidance rather than
commitments: Firebase on A1 (retained offline), Convex on A5 and A6
(functions, scheduling, vector), Supabase on A5 (storage, pgvector, search),
InstantDB on A1/A2 (compact React offline/room ergonomics), SpacetimeDB on A6
(transactional reducers). Probes are timeboxed at the deep-arm ceiling, use
official provider paths, receive the same diary and cleanup discipline, and
produce reference observations — never ranking claims, and never reusable as
Phase 2 championship arms.

### Track B — Expo sweep

After the web sweep covers A1 and A4, carry both onto Expo: Snapback
implements each with independent `ios` and `android` receipts, from the same
external-consumer posture. A Snapback Expo arm may use the supported local
bridge from a simulator or emulator; hosted availability is recorded as a GAP
finding, never an invented local equivalence. Simulator and emulator receipts
qualify for the sweep; physical-device receipts are a separately reported
production-support gate. Firebase is the pre-declared mobile reference probe,
run only under the probe rules above.

Each receipt must record:

- exact Expo SDK, React Native, backend client, OS, device/simulator, and build
  artifact identities;
- clean release or development-client launch through the supported path;
- native auth entry and deep-link return where the app requires it;
- initial authoritative data and a second-device realtime transition;
- background, suspension, foreground, network loss, and reconnect behavior;
- cold process restart and protected retained state where claimed;
- queued mutation settlement and rollback where claimed;
- file selection/upload for A4;
- push-notification boundary or explicit GAP for A4;
- authority rotation/logout and predecessor-data retirement; and
- teardown of processes, credentials, projects/namespaces, and test data.

### Track C — Exact multi-platform graduation

Use the frozen A1 product contract for one Snapback-only three-surface
exercise:

1. Contract/web;
2. Exact Native/iOS; and
3. Exact Native/Android.

Claims follow LLP 0064 exactly:

- Contract/web claims only what its provider and acceptance receipt prove;
- `exact-native/ios` and `exact-native/android` are independent profiles;
- an `Online` result does not imply local-first `Parity`; and
- `Parity` requires generated local execution, retained reads, a durable
  ordered queue, replay/rebase, authority fencing, reconnect convergence, and
  release-artifact exclusion of server implementation.

If the Exact Native surface is not ready when the sweep completes, Track C
records an honest program GAP and remains a separate successor gate. No
polling gateway, Contract-on-Hermes instrument, or React Native carrier
substitutes for an Exact Native profile.

## Execution gates

### G0 — sweep freeze

Before the first diaried arm: freeze the six product contracts and acceptance
identifiers, the neutral React and Expo shells, the probe policy above, the
evidence schemas and expected-check-count manifests, and the assistance
policy; preflight credentials without revealing them. Phase 1 does not freeze
a Snapback revision — that is Phase 2's control.

### G1 — public Snapback package consumption

No diaried Snapback arm starts until a clean external repository can:

- install the complete terminal `@expo/snapback-*` closure from the public npm
  channel by immutable version;
- verify the registry artifacts against the retained publication ledger;
- typecheck every public subpath used by the arm;
- scaffold, generate, build, start, inspect, and stop through package-owned
  commands and helpers;
- execute a real handler in the qualified runtime;
- report exact package, binary, runtime-readiness, and bundle identities; and
- finish with no process, listener, secret sidecar, checkout-relative import,
  or manual sibling dependency.

The smoke arm is untimed qualification, and every defect it surfaces is
already sweep output. Failure returns to LLP 0041/0115 CV-1.

### G2 — fair target access

Prefer fresh isolated targets. A shared hosted target follows LLP 0102's
namespace, baseline, scoped-cleanup, and confidence rules. Missing hosted
access is an explicit GAP finding, never an invented local equivalent.

### G3 — platform honesty

Expo arms begin only after the provider's recommended React Native path and
required build mode are pinned. Exact begins only against the profiles and
receipt rules owned by LLP 0064 and the applicable Exact LLPs. Unsupported
tuples stay visible.

## Execution stages

1. **Stage 0 — freeze.** Pass G0; build shells and verifiers; retain the
   freeze digest.
2. **Stage 1 — package qualification.** Pass G1 on supported macOS and Linux
   hosts; file everything it surfaces.
3. **Stage 2 — web sweep.** Run the six Snapback arms in order (A2, A1, A3,
   A4, A5, A6), filing findings continuously and landing fixes between arms.
4. **Stage 3 — probes.** Run fresh competitor probes as the probe policy
   justifies them; probes may interleave with Stage 2 once their triggering
   finding exists.
5. **Stage 4 — Expo sweep.** Run the Snapback A1/A4 Expo arms and any
   justified mobile probe; freeze the mobile findings before Exact results
   are revealed.
6. **Stage 5 — Exact graduation.** Run Track C or record the precise unready
   gate; never delay the sweep report for it.
7. **Stage 6 — synthesis.** Produce the gap ledger, longitudinal comparison,
   differentiator inventory, and prioritized improvement program; assess the
   dry-well trigger.
8. **Stage 7 — championship (deferred).** When the trigger fires, execute
   Phase 2 below under its own freeze.

## Diary and evidence protocol

Create one numbered diary per application when its first arm begins, using the
next available diary number and the repository convention. Snapback arms,
probes, and Expo arms append immutable dated entries, clearly labeled; the
Exact exercise gets its own diary. Corrections append an erratum; they never
rewrite the original experience. Every arm retains a machine-readable capsule
with an expected check count, target identity, cleanup proof, and
transport/authority/settlement attribution.

Every entry records:

- exact versions, target/build identity, platform, docs snapshot, and plan;
- timed window, tool calls/tokens where available, and assistance events;
- time to install, first read, mutation, verified realtime, local acceptance,
  hosted URL, and cleanup;
- what felt easy, coherent, surprising, repetitive, or uncertain;
- modeling, type flow, transaction, conflict, auth, realtime, offline, and
  settlement experience;
- deployment, logs, migration, backup/restore, and operational experience;
- authored, generated, policy, test, configuration, and glue inventories;
- pass, GAP, fail, unavailable, expected-refusal, and Stop results;
- whether the builder would choose the backend for this app and why; and
- concrete lessons for Snapback, including what must be preserved.

## The gap ledger and improvement synthesis

The sweep's primary deliverable is a gap ledger organized by the ten
dimensions below, replacing any composite for Phase 1:

- installed-product first hour;
- TypeScript inference and contract fidelity;
- React reactivity and lifecycle;
- relational composition and aggregates;
- retained offline and reconnect settlement;
- authorization and revocation;
- conflicts, jobs, effects, and ambiguity;
- assets, text search, vector retrieval, and notifications;
- hosted deployment and operations; and
- diagnostics, documentation, agent usability, and ecosystem escape hatches.

For every finding, the ledger states:

1. the concrete observation and its diary/capsule evidence;
2. the strongest competitor outcome on the same product fact, with its source
   (frozen evidence or probe);
3. whether the gap is a defect, capability, experience, documentation,
   operations, maturity, benchmark-only issue, or deliberate non-goal;
4. the Snapback property that must not regress while fixing it;
5. the smallest coherent Snapback-native improvement outcome;
6. the acceptance witness that would prove it; and
7. its owner: immediate repair, filesystem issue, existing LLP, new LLP, or
   explicit refusal.

The synthesis must distinguish table stakes, repeated first-hour and
daily-loop friction, breadth gaps exposed by one advanced app, differentiators
worth amplifying, maturity and ecosystem gaps code cannot close, hosted and
operational gaps, mobile-only and Exact-only findings, and architectural
rethink triggers. Do not create Convex-shaped, Supabase-shaped, or
Firebase-shaped subsystems solely to make a fixture pass; match valuable
outcomes through Snapback's authority, settlement, local-first, target, and
capability model.

### Honesty controls

- Give every implementation the same product facts, not the same internal
  design; use official provider paths and record source/community/human help.
- Do not count polling as push, optimistic UI as authority, cached seed as an
  offline mutation, or a rendered Expo screen as an OS lifecycle proof.
- Preserve failed attempts, security Stops, credential incidents, and builder
  mistakes with correct attribution; findings are never softened because the
  product under test is ours.
- Performance observations follow LLP 0035 and support only the workload
  actually measured.
- Probe evidence and frozen evidence are always labeled with their source and
  date; stale frozen evidence is flagged, not silently treated as current.

## Phase 2 — the deferred backend championship

Phase 2 is preserved here so the design survives until it is worth running.
It begins only when the **dry-well trigger** fires: Charlie judges the
improvement backlog thin enough that a ranking would outlast it — the default
signal being a re-verification sweep across the six contracts that produces no
new table-stakes or Stop-class findings.

The frozen design, unchanged from this document's v2 revision:

- **Backends:** Snapback, Convex, Supabase, Firebase, each on its current
  official recommended path, frozen at Phase 2's own G0.
- **Matrix:** a symmetric core — A1, A2 (calibration), A3, A4 across all four
  backends — plus extension arms A5 (Snapback, Convex, Supabase) and A6
  (Snapback, Convex); twenty-one timed arms. The three cut arms are designed
  non-coverage, reinstatable only by dated amendment.
- **Controls:** one frozen Snapback revision across all arms; atomic
  per-contract rounds so no backend systematically builds last; provider
  order randomized per round; LLP 0102's budget classes enforced as ceilings;
  no repository access beyond a normal npm consumer.
- **Scoring:** LLP 0102's ten-category, 100-point composite as an equal-weight
  mean over the four core contracts — comparable to 0102 at the level of
  category definitions, weights, and rating anchors — plus the uncollapsed
  dimension ledger, per-contract verdicts (four-way core, per-shape
  extension), a labeled six-contract Snapback–Convex head-to-head, sensitivity
  analysis, practical-tie rules, and an independent subjective-rating audit by
  a model family that did not build the scored arms. Extension and challenger
  arms never enter the core composite. Stop-class defects are displayed beside
  scores and disqualify go-to eligibility for the affected application.
- **Track B ranking:** Snapback + Firebase Expo baseline with author-checkpoint
  expansion to Convex/Supabase; mobile ordering scoped to actual coverage.
- **Challengers:** InstantDB (A1, A2) and SpacetimeDB (A6) behind an author
  checkpoint, producing per-app judgments only.

All Phase 2 evidence is produced fresh under that freeze. A later Snapback
remediation epoch may rebuild the same contracts and publish an additive
confirmation report; it preserves the original diaries, versions, timings,
scores, and ranking.

## Deliverables

Phase 1:

- six frozen application contracts, neutral React shells, and two Expo shells;
- the G1 external-consumption qualification record and its findings;
- six Snapback web arms, two Snapback Expo arm pairs with independent iOS and
  Android receipts, and justified probes — each with immutable diary entries
  and machine-readable capsules;
- three Snapback Exact/Contract platform arms or precise GAP records;
- the gap ledger with owners and acceptance witnesses, the differentiator
  must-not-regress inventory, the longitudinal comparison against frozen LLP
  0102 lineage evidence, and the prioritized improvement program;
- the stream of filed tickets and LLP updates the fix loop produced; and
- a dated dry-well assessment.

Phase 2, when triggered: the championship deliverables enumerated above —
twenty-one arms or terminal records, the composite and rankings with
sensitivity analysis, the head-to-head, the mobile and challenger reports, and
the independent audit.

## Open questions

1. Who is the independent rating reviewer for Phase 2, and when are their
   prompts and builder-score blindness frozen? (Deferred with Phase 2.)
2. Should the dry-well trigger's default signal — a re-verification sweep with
   no new table-stakes or Stop-class findings — be tightened or replaced once
   the sweep's finding rate is observable?

## Status

Draft. Planning, review, shell construction, and verifier work may proceed.
Diaried sweep execution is blocked on G0 and G1, the public terminal-package
qualification. Phase 2 is additionally blocked on the dry-well trigger. No
backend, mobile, or Exact ranking is claimed by this document.
