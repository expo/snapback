# LLP 0137: React-web backend championship and native validation

**Type:** Plan
**Status:** Draft
**Systems:** Competitive evaluation, Demo applications, React, React/Expo, Exact Native, Developer experience, Data modeling, Realtime, Offline sync, Auth, Assets, Search, Actions, Scheduled work, Deployment, Operations, Testing, Documentation
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-31
**Revised:** 2026-07-31 (refine pass: specialist-challenger start gate unified on the required-Track-A-arms freeze rather than the ambiguous "matrix freeze"; historical-composite comparability scoped to category definitions, weights, and rating anchors across a six-contract mean versus LLP 0102's five; Track B gains the explicit both-contracts eligibility rule mirroring Track A's no-silent-zero treatment; all cross-references verified against the corpus — LLP 0102's ten-category/100-point composite and 4h/200-call, 8h/400-call budgets, LLP 0064's exact-native profile and Parity vocabulary, LLP 0115 CV-1, Diaries 0027–0039). 2026-07-31 (initial draft: a four-backend React-web championship, a separately scored Expo validation, a Snapback-only Exact Native graduation exercise, and selective specialist challengers, all gated on public-package consumption)
**Related:** LLP 0000, LLP 0010, LLP 0015, LLP 0016, LLP 0035, LLP 0041, LLP 0064, LLP 0074, LLP 0093, LLP 0102, LLP 0103, LLP 0105, LLP 0107, LLP 0114, LLP 0115, LLP 0129, LLP 0130, Diary 0027–0039

## Summary

Run the next competitive evaluation as three related but non-interchangeable
programs:

1. a **primary React-web championship** across Snapback, Convex, Supabase, and
   Firebase, using six substantial application contracts;
2. a **smaller Expo validation** across the same backends, using two of those
   contracts and independent iOS and Android receipts; and
3. a **Snapback-only Exact multi-platform graduation exercise**, using one
   frozen product contract across Contract/web, Exact Native/iOS, and Exact
   Native/Android.

The React-web program produces the backend ranking. Expo produces a separate
mobile-suitability ranking. Exact answers whether Snapback can carry one
application contract coherently across web and native; it does not contribute
points to the backend ranking.

Firebase joins Snapback, Convex, and Supabase as a required primary backend
because it is the most informative incumbent for retained offline behavior and
integrated mobile services. InstantDB and SpacetimeDB may run as bounded
specialist challengers after the required Track A arms freeze, but they are
not silently mixed into the four-backend total order. Appwrite and other providers
from LLP 0102 are not rerun without a dated amendment naming a new research
question.

Planning and fixture work may begin immediately. Timed Snapback arms may not
begin until the terminal `@expo/snapback-*` package closure is publicly
installable and one clean external smoke arm proves that the matrix can consume
it without a Snapback checkout. This is the starting gun for execution, not a
reason to defer protocol design.

## Why this is a successor rather than an LLP 0102 revision

LLP 0102 owns the completed seven-backend, five-app bakeoff and its frozen
evidence. That program established a broad market map, a reusable evidence
discipline, and a historical ranking. Amending it into a new experiment would
blur the versions, assistance policy, package boundary, and result that its
reports preserve.

This Plan therefore inherits LLP 0102's rules for provider-native
implementations, Stop-class defects, target isolation, immutable diaries,
measurement records, independent rating audit, and separation of current
product score from architectural potential. Where this Plan differs, this
document controls prospectively.

LLP 0115 remains the owner of the Snapback × Convex parity rerun and its
course-correction exits. LLP 0129 remains the owner of Snapback's local-first
program. This Plan consumes their shipped state and measurements; it does not
change their completion criteria or turn a competitive arm into implementation
evidence for an unproved capability.

## Research questions

The primary question is:

> After the current productization, breadth, React, and local-first work, which
> backend would a competent builder choose today for a new React web
> application, and why?

The program also asks:

- Has Snapback become as easy to install and start as Convex and Supabase?
- Does Snapback match Convex's ordinary TypeScript and reactive authoring loop
  without giving up explicit authority, settlement, and capability evidence?
- Does Snapback match Supabase's relational, storage, search, vector, and
  operational breadth without collapsing into provider-specific escape
  hatches?
- Does Snapback match Firebase's retained offline and mobile lifecycle outcomes
  while preserving stronger conflict, revocation, and effect semantics?
- Which remaining differences are product defects, missing table stakes,
  deliberate tradeoffs, maturity gaps, documentation failures, or merely
  stylistic preferences?
- Are Snapback's differentiators valuable in normal applications, or visible
  only in adversarial acceptance tests?
- Does the backend conclusion change on Expo?
- Can one Snapback application contract graduate across Contract/web and Exact
  Native on both mobile operating systems without claim inflation?

## Program boundaries

### One backend ranking, two validation reports

Only Track A produces the general backend ranking. Tracks B and C are reported
beside it because platform behavior matters, but their scores never silently
alter the web result.

This separation prevents three confounds:

- Expo lifecycle, native auth, and application packaging are not backend-only
  properties;
- Exact Native is a Snapback carrier and integration program, not another
  backend; and
- an iOS pass does not establish Android behavior, or vice versa, under LLP
  0064.

### Comprehensive backends versus composable layers

The required providers are products that plausibly supply the ordinary
application backend as one coherent offering. Databases and sync layers such
as Neon, PlanetScale, ElectricSQL, PowerSync, Zero, LiveStore, or Turso are not
ranked as though they independently supplied auth, functions, files,
scheduling, effects, deployment, and operations.

A future composable-stack study may compare complete named assemblies. It must
count every selected service, integration, policy surface, credential,
deployment, and application-owned glue. It is not an amendment to this matrix
by implication.

## Track A — primary React-web championship

### Required backends

| Backend | Why it is required | Profile to freeze |
| --- | --- | --- |
| Snapback | Product under improvement; authority, settlement, ephemeral, and local-first thesis | public `@expo/snapback-*` packages; supported local target; first honestly supported hosted target or explicit GAP |
| Convex | strongest integrated TypeScript functions, transactions, generated types, and reactive-query comparison | current official local and managed paths |
| Supabase | strongest SQL/RLS, storage, search/vector, and operational escape-hatch comparison | current official local CLI stack and managed project |
| Firebase | strongest retained-offline and integrated mobile-services comparison | current official emulator/local path and managed project |

Provider versions, plans, regions, official starters, documentation snapshots,
and target identities are frozen before implementation. A changed recommended
path replaces the table's shorthand prospectively before evidence is revealed.

### The six application contracts

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

### Primary-matrix size

Six contracts by four backends produce twenty-four primary arms. Every backend
must attempt every contract to be eligible for total ordering. A timeboxed or
blocked arm remains evidence; it is not silently scored as an ordinary zero.

## Track B — Expo mobile validation

After Track A freezes, carry A1 (Offline field notebook) and A4 (Event and
invitation) into Expo. Reusing the contracts isolates platform effects while
covering the two most important mobile shapes: offline/background work and
deep-link/assets/notification work.

Each backend gets two implementations, one per product contract, with
independent `ios` and `android` receipts. Shared React Native source is
expected; shared source never turns one operating-system receipt into two.

Each receipt must record:

- exact Expo SDK, React Native, backend client, OS, device/simulator, and build
  artifact identities;
- clean release or development-client launch through the frozen supported
  path;
- native auth entry and deep-link return where the app requires it;
- initial authoritative data and a second-device realtime transition;
- background, suspension, foreground, network loss, and reconnect behavior;
- cold process restart and protected retained state where claimed;
- queued mutation settlement and rollback where claimed;
- file selection/upload for A4;
- push-notification boundary or explicit GAP for A4;
- authority rotation/logout and predecessor-data retirement; and
- teardown of processes, credentials, projects/namespaces, and test data.

Track B publishes a mobile-suitability ranking and per-OS GAP table. A backend
must attempt both Expo contracts to be eligible for the mobile ordering; as in
Track A, a timeboxed or blocked arm remains evidence and is not silently
scored as an ordinary zero. Track B does not modify Track A's web composite.

## Track C — Exact multi-platform graduation

Use the frozen A1 product contract for one Snapback-only three-surface
exercise:

1. Contract/web;
2. Exact Native/iOS; and
3. Exact Native/Android.

This track is not “Snapback gets a special frontend” inside the championship.
It asks whether Snapback's generated contract and local-first semantics survive
three carriers.

Claims follow LLP 0064 exactly:

- Contract/web claims only what its provider and acceptance receipt prove;
- `exact-native/ios` and `exact-native/android` are independent profiles;
- an `Online` result does not imply local-first `Parity`; and
- `Parity` requires generated local execution, retained reads, a durable
  ordered queue, replay/rebase, authority fencing, reconnect convergence, and
  release-artifact exclusion of server implementation.

If the Exact Native surface is not ready when Tracks A and B complete, Track C
records an honest program GAP and remains a separate successor gate. No polling
gateway, Contract-on-Hermes instrument, or React Native carrier substitutes for
an Exact Native profile.

## Selective specialist challengers

Specialist arms are optional and begin only after the required Track A arms
freeze:

- **InstantDB:** A1 and A2, to test compact React/offline/room ergonomics;
- **SpacetimeDB:** A6, to test transactional reducers, contention, and live
  operational views.

These arms receive the same acceptance and diary discipline. They produce
per-app challenger judgments, not a misleading six-provider overall order
based on partial coverage.

Adding another provider requires a dated amendment before its implementation
begins. The amendment names the unique research question, contracts, budget,
and whether it seeks full-ranking eligibility or specialist status.

## Execution gates

### G0 — protocol freeze

Before timed work:

- freeze this Plan's reviewed revision;
- freeze all six product contracts and acceptance identifiers;
- materialize neutral React shells and the two Expo shells;
- freeze provider profiles, versions, official docs, plans, regions, and target
  lifecycle;
- freeze agent model, reasoning setting, skills, assistance policy, machine
  profiles, and time/tool budgets;
- create expected-check-count manifests and secret-safe evidence schemas;
- preflight credentials without revealing them; and
- randomize backend order once per app.

### G1 — public Snapback package consumption

No timed Snapback arm starts until a clean external repository can:

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

The smoke arm is untimed qualification, not a championship result. Failure
returns to LLP 0041/0115 CV-1; it does not lower a frozen timed score before
the experiment has valid inputs.

### G2 — fair target access

Prefer fresh isolated targets. A shared hosted target follows LLP 0102's
namespace, baseline, scoped-cleanup, and confidence rules. Missing hosted
access is an explicit GAP or unavailable dependency, never an invented local
equivalent. Hosted unavailability does not block local authoring evidence, but
it receives no deployment, operations, regional, or cost credit.

### G3 — platform honesty

Expo begins only after each selected provider's recommended React Native path
and required build mode are pinned. Exact begins only against the profiles and
receipt rules owned by LLP 0064 and the applicable Exact LLPs. Unsupported
tuples stay visible.

## Execution stages

### Stage 0 — review and freeze

Review this Plan, resolve its open questions, build the neutral shells and
verifiers, pass G0, and retain the freeze digest.

### Stage 1 — package qualification

Wait for public npm publication, then pass G1 from a clean external project on
supported macOS and Linux hosts. Record publication and resolver propagation
separately from product qualification.

### Stage 2 — web calibration

Run A1 and A2 across all four backends. Freeze a calibration report before
proceeding. Calibration may repair a provider-neutral harness defect, but it
may not change a product contract or Snapback implementation without a dated
protocol amendment and complete restart of affected frozen arms.

### Stage 3 — deep web round

Run A3–A6 across all four backends. Snapback stays on one frozen product
revision for all twenty-four primary arms. Preserve timeboxed failures and
untimed learning extensions separately.

### Stage 4 — Expo validation

Run A1 and A4 on Expo for every required backend, retaining independent iOS and
Android receipts. Freeze the mobile report before Exact results are revealed.

### Stage 5 — Exact graduation

Run A1 across Contract/web and the two Exact Native profiles, or record the
precise unready gate. This stage never delays publication of the backend and
Expo reports.

### Stage 6 — specialist challengers

Run the predeclared InstantDB and SpacetimeDB arms if their additional signal
still justifies the cost after the primary reports freeze.

### Stage 7 — synthesis and ranking

Produce the complete evidence audit, rankings, qualitative comparison, and
Snapback improvement program. Do not change the frozen baseline ranking after
reading the synthesis.

A later Snapback remediation epoch may rebuild the same contracts and publish
an additive confirmation report. It preserves the original diaries, versions,
timings, scores, and ranking.

## Diary and evidence protocol

Create one numbered diary per Track A application when execution begins, using
the next available diary number and the repository convention. Each backend
appends an immutable dated entry. Expo observations append clearly labeled
platform entries to A1 and A4. The Exact exercise gets its own diary because it
evaluates carrier graduation rather than another backend arm.

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

Corrections append an erratum. They never rewrite the original experience.
Every arm retains a machine-readable capsule with an expected check count,
target identity, cleanup proof, and transport/authority/settlement attribution.

## Measurement and scoring

### Raw outcomes first

Before any composite, report:

- product completeness by acceptance fact;
- first-hour and total authoring cost;
- correctness/evidence confidence;
- dependency and local-runtime footprint;
- representative latency and resource samples under a frozen machine profile;
- hosted/deployment availability and list-price evidence; and
- every workaround and application-owned service.

Performance follows LLP 0035 and supports only the workload actually measured.
Different machines, target classes, or regions prohibit a synthetic league
table unless the frozen benchmark profile proves comparability.

### Historical composite

Track A retains LLP 0102's ten-category, 100-point holistic composite so the
new result remains comparable to the earlier bakeoff. The backend score is the
equal-weight mean over the six Track A contracts rather than LLP 0102's five
apps; comparability is at the level of category definitions, weights, and
rating anchors, not identical application portfolios. Revisions to a category
definition require a parallel rescoring of the prior evidence or a clearly
labeled second composite; they never overwrite the historical score.

The report also shows an uncollapsed dimension ledger for:

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

The dimension ledger is the basis for the “better than both on every
dimension” analysis. A weighted composite cannot hide a Stop-class defect or a
table-stakes GAP.

### Separate platform reports

Track B reports per-backend mobile product completeness, iOS/Android receipt
coverage, mobile authoring cost, and a separate mobile-suitability composite.
Track C reports profile graduation and qualitative carrier coherence; it has
no backend composite.

### Ranking and review

Publish:

- per-app Track A rankings;
- the overall Track A backend order and practical ties;
- sensitivity analysis under LLP 0102's method;
- the separate Track B mobile order;
- Track C graduation results;
- specialist challenger judgments; and
- an independent subjective-rating audit by a model family that did not build
  the scored arms, retained alongside disagreements.

Architectural potential remains a separate narrative and contributes zero
points to the current-product ranking.

## Snapback improvement synthesis

For every dimension, state:

1. what Snapback does better today;
2. what Snapback does worse today;
3. the strongest competitor outcome and its evidence;
4. whether the gap is a defect, capability, experience, documentation,
   operations, maturity, benchmark-only issue, or deliberate non-goal;
5. the Snapback property that must not regress;
6. the smallest coherent Snapback-native improvement outcome;
7. the acceptance witness that would prove it; and
8. its owner: immediate repair, filesystem issue, existing LLP, new LLP, or
   explicit refusal.

The final report must distinguish:

- table stakes required to be a credible default;
- repeated first-hour and daily-loop friction;
- breadth gaps exposed by only one advanced app;
- differentiators worth amplifying;
- product maturity and ecosystem gaps that code alone cannot close;
- hosted and operational gaps;
- mobile-only and Exact-only findings; and
- architectural rethink triggers.

Do not create Convex-shaped, Supabase-shaped, or Firebase-shaped subsystems
solely to make a fixture pass. Match valuable outcomes through Snapback's
authority, settlement, local-first, target, and capability model.

## Bias controls

- Freeze the complete primary matrix before its first timed arm.
- Keep one Snapback revision across all required Track A arms.
- Randomize provider order per app before implementation.
- Give every backend the same product facts, not the same internal design.
- Use official provider paths and starters; record source/community/human help.
- Do not reward Snapback for repository access unavailable to a normal npm
  consumer.
- Do not penalize managed providers merely for being managed.
- Do not count polling as push, optimistic UI as authority, cached seed as an
  offline mutation, or a rendered Expo screen as an OS lifecycle proof.
- Preserve failed attempts, security Stops, credential incidents, and builder
  mistakes with correct attribution.
- Refresh current provider paths from primary sources at freeze and before the
  final report.
- Keep Track A, Track B, and Track C scores separate.

## Deliverables

- six frozen application contracts and neutral React shells;
- two Expo shells and one Exact multi-platform contract;
- twenty-four required web arms or explicit terminal records;
- up to eight Expo implementations with independent iOS and Android receipts;
- three Snapback Exact/Contract platform arms or precise GAP records;
- optional specialist-arm evidence;
- numbered immutable diaries;
- machine-readable acceptance, target, cleanup, package, and measurement
  capsules;
- calibration, web-final, mobile, Exact, independent-audit, and evidence-audit
  reports;
- per-app and overall rankings with sensitivity analysis;
- a full qualitative comparison; and
- a prioritized Snapback improvement plan aimed at matching or exceeding
  Convex and Supabase on every named dimension while preserving Snapback's
  demonstrated advantages.

## Open questions

1. Should Firebase be a full fourth backend, as proposed, or only a mandatory
   A1/A4 offline-and-mobile reference? The full arm preserves ranking symmetry;
   the selective arm saves substantial time.
2. Should Track B require physical-device receipts before its final ranking,
   or report simulator/emulator graduation first and physical-device evidence
   as a production-support gate?
3. Does Track B require hosted Snapback, or may a simulator/emulator use the
   supported local bridge while hosted availability remains a scored GAP?
4. Should the specialist arms execute automatically, or require an author
   checkpoint after Track A shows whether they still add information?
5. What exact active-time and tool-call budgets should replace or retain LLP
   0102's four-hour calibration and eight-hour deep-app ceilings?
6. Who is the independent rating reviewer, and when are their prompts and
   builder-score blindness frozen?

## Status

Draft. Planning, review, shell construction, and verifier work may proceed.
Timed provider execution is blocked on G0. Timed Snapback execution is also
blocked on G1, the public terminal-package qualification. No backend, mobile,
or Exact ranking is claimed by this document.
