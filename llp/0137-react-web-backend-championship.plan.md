# LLP 0137: React-web improvement sweep and deferred backend championship

**Type:** Plan
**Status:** Draft
**Systems:** Competitive evaluation, Demo applications, React, React/Expo, Exact Native, Developer experience, Data modeling, Realtime, Offline sync, Auth, Assets, Search, Actions, Scheduled work, Deployment, Operations, Testing, Documentation
**Author:** Charlie Cheever / Codex / Claude
**Date:** 2026-07-31
**Revised:** 2026-08-01 (Diary 0050 PocketBase × public-npm Snapback 0.1.8 bounded probe adds a seven-outcome correction packet: public React identity, asset authority custody, handler read-your-writes, membership-policy composition, push-default clarity, warning/export coherence, and measured footprint budgets; the probe is improvement evidence, not Phase-2 ranking evidence). 2026-08-01 (Track C status note: Stage 5/6 readiness assessment run — the Exact Native surface is NOT ready for the frozen A1 contract; honest program GAP recorded per this plan's Track C rule with four precise unready gates (plan-tier expressibility of A1's membership/JS-handler operation tier, stale b79c695f authority pin in the exact-side generated Rust modules, no app-agnostic carrier/capture/import path beyond the Partitime-specific crates and gates, no native asset/sessions-custody coverage for A1-04/A1-02); Partitime-workload Parity receipts (2026-07-21) remain real and non-transferable; Contract/web available-but-not-run; gap-record + ticket filed; Track C remains a successor gate and the sweep report is not delayed). 2026-08-01 (Track B A4 Expo iOS arm status note: second and final planned Expo sweep arm complete — 8 pass / 3 GAP / 1 evidenced-defect fail on the 12 a4-applicable EXPO checks, iOS simulator, release build, G3 pin honored; the A4 deep-link invitation entry exercised as a real OS-level deep link; on-device flyer upload/rendition/strict-delivery/native-render proven (owner lane; the a1-f2/a4-f3 non-owner hole re-verified on 0.1.7 — the 117dcae2 main fixes are post-publication); findings 0137-a4expo-f1 (no mobile push boundary) and 0137-a4expo-f2 (deep-link scheme-approval guide-gap) filed; a1expo-f2/f4 re-verified and f7 narrowed via dated ticket appends; android honest not-run (JDK absence re-verified); freeze re-verified). 2026-08-01 (Track B A1 Expo iOS arm status note: first Expo sweep arm complete — 7 pass / 2 GAP / 1 evidenced-defect fail on the 10 a1-applicable EXPO checks, iOS simulator, release build, G3 pin honored; findings 0137-a1expo-f1..f7 filed (WebCrypto prerequisite, queue cannot engage on Expo fetch errors, no on-device durable store, downgrade-rotation wedge, hosted mobile GAP, react-expo guide-gap, RN connection cycling); android honest not-run (no JDK); freeze re-verified). 2026-08-01 (A6 arm status note: sixth and final diaried web sweep arm complete — 10 pass / 0 GAP / 0 fail, the sweep's first fully green arm; findings 0137-a6-f1..f3 filed (defineJobStatusQuery boot refusal; jobs/secret-read custody guide-gap; reset-install strands live clients); jobs_one_off_v1 core verified end to end externally; freeze re-verified). 2026-08-01 (A5 arm status note: fifth diaried sweep arm complete — 11 pass / 1 GAP / 1 evidenced-defect fail; findings 0137-a5-f1..f3 filed; the Diary 0031 sessions+streamed-actions blocker verified reversed on the packaged closure; freeze re-verified). 2026-08-01 (A4 arm status note: fourth diaried sweep arm complete — 9 pass / 2 evidenced-defect fails / 0 GAP; findings 0137-a4-f1..f7 filed; freeze re-verified). 2026-08-01 (A2 arm status note: first diaried sweep arm complete — 11 pass / 1 GAP / 0 fail; findings 0137-a2-f1..f8 filed; freeze re-verified). 2026-07-31 (v3 purpose inversion per Charlie's direction: the program now exists to surface what would make Snapback better, not to prove Snapback is better — that proof is deferred until the improvement well runs dry. Phase 1 is a Snapback-first improvement sweep over all six contracts as an external npm consumer, with a mid-program fix loop, frozen-evidence-first competitor referencing, and demand-driven fresh probes; the symmetric championship — core/extension matrix, composite, ranking controls — is preserved compactly as deferred Phase 2 behind a dry-well trigger. Ranking-fairness controls that obstruct improvement, chiefly the single frozen Snapback revision and atomic rounds, move to Phase 2; honesty controls stay). 2026-07-31 (v2 efficiency restructure: sixteen-arm symmetric core over A1–A4 plus five extension arms; contract lineage to LLP 0102 with a zero-new-arm longitudinal comparison; atomic per-contract rounds; Track B baseline + checkpoint; former open questions 1–5 resolved). 2026-07-31 (refine pass: challenger gate unified; composite comparability scoped; Track B eligibility rule; cross-references verified). 2026-07-31 (initial draft: a four-backend React-web championship, a separately scored Expo validation, a Snapback-only Exact Native graduation exercise, and selective specialist challengers, all gated on public-package consumption)
**Related:** LLP 0000, LLP 0010, LLP 0015, LLP 0016, LLP 0035, LLP 0041, LLP 0044, LLP 0056, LLP 0064, LLP 0073, LLP 0074, LLP 0093, LLP 0095, LLP 0100, LLP 0102, LLP 0103, LLP 0105, LLP 0107, LLP 0108, LLP 0114, LLP 0115, LLP 0122, LLP 0129, LLP 0130, LLP 0132, LLP 0133, LLP 0135, LLP 0136, Diary 0027–0039, Diary 0050

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

## Diary 0050 correction packet — close the first-working-app gap

Diary 0050 is a fresh, bounded PocketBase comparison against the complete
public `@expo/snapback-*` 0.1.8 closure. It is admitted under Phase 1's probe
rules because PocketBase's relation rules, protected record files, SSE client,
single-binary lifecycle, and durable-presence workaround provide concrete
current-generation reference outcomes for product facts the earlier sweep did
not settle cleanly. It is **improvement evidence, not Phase 2 ranking
evidence**: the arm was not part of the frozen symmetric matrix, used one local
Apple-silicon target, and has no hosted or throughput claim.

The probe's useful result is not “copy PocketBase.” It isolates a
**first-working-app gap**: Snapback's stronger authority, generated-contract,
atomicity, ephemeral-state, and diagnostic model is visible, but an external
React builder must cross too many client seams before those strengths compose
into an ordinary app. The next public closure should close that gap through the
seven outcomes below, in priority order.

### P0 — restore already-promised public closure

1. **First-party React identity.** Implement the already-specified LLP 0114
   `devPrincipal` seam in the public React package and preserve the prepared
   client's sole authority ownership. A clean external app must represent Ada
   and Grace with two providers, use generated hooks for every operation, and
   never pass `userId` per operation or escape to a raw client. Sessions and
   hosted targets must continue to refuse dev principals.
2. **Asset authority custody.** Close
   `issues/20260801-0137-a1-packaged-asset-client-cannot-authenticate-sessions.md`
   for both dev and sessions authority. Route the framework-neutral asset task
   through the prepared client's authenticated transport as LLP 0044 requires;
   align root runtime exports with their published types. The witness starts,
   transfers, finalizes, attaches, downloads, revokes, and deletes through only
   public packages, with negative cross-user and logout cases.
3. **Handler read-your-writes.** Treat Diary 0050's `patch` followed by
   `ctx.db.get` returning the predecessor row as a conformance regression, not
   a new semantic choice: LLP 0000 and LLP 0003/0004 already say buffered
   handler reads observe earlier writes. The witness covers point get, query,
   and returned-result validation after insert/patch/delete, on every evaluator
   claiming the JS-handler profile.

These three outcomes are release blockers for the correction packet. A new
package closure must not claim React or asset completeness while any remains an
expected GAP in the external witness.

### P1 — declare authority once and receive real live behavior

4. **Membership-policy composition.** Continue the existing LLP 0056/0100
   direction rather than blessing the bakeoff's parallel `incidentAccess`
   table. One resource-membership declaration must support: listing the
   caller's resources, ordinary and relational live reads, membership-visible
   full-text search, and asset read/delivery policy. This closes the existing
   A2 self-seat and A3 search-visibility tickets together. Acceptance uses one
   membership fact, no authorization mirror, and proves member access,
   outsider denial, revocation blanking, search disappearance, and strict asset
   denial from the same seat change.
5. **Push-default clarity.** On a target advertising the live-stream
   capability, the generated/React paved path should select stream transport
   without a caller spelling `transport: "stream"`. Poll remains an explicit
   lane and an explicit fallback under LLP 0095; it must never silently satisfy
   a push assertion. Acceptance mutates from a second client, disables poll
   fallback, observes unsolicited bounded delivery, and reports the selected
   transport in inspectable client state.

### P2 — make the paved first hour internally coherent

6. **Warning-free starter and export parity.** Close the existing degraded
   result-contract starter ticket without weakening LLP 0108's advisory, and
   extend the external-package export gate so every public type export has the
   same runtime value or a deliberate type-only declaration. A fresh scaffold,
   generate, typecheck, and production build must complete without a Snapback
   warning, ambient shim, undocumented subpath correction, or repository
   import.
7. **Measured footprint budgets.** Establish separate regression budgets for
   installed native runtime bytes and tree-shaken browser bytes before choosing
   an optimization. Diary 0050's 195.0 MiB install and 456.2 kB production JS
   bundle are one baseline, not universal limits. The browser budget must keep
   server/runtime code out of the client graph; the install budget must retain
   the self-contained npm runtime and its readiness receipt rather than
   externalizing setup work to the user. LLP 0122 owns the packaging analysis.

### Execution and release gate

Execute in four landings: (1) P0 conformance repairs; (2) membership
composition; (3) live/default and starter/export coherence; (4) footprint
measurement followed by separately justified reductions. Each landing updates
its governing LLP or issue and adds its focused public-package witness. Do not
bundle a semantic redesign into a conformance repair.

The packet exits only when a clean external React incident-room app, installed
from one exact public package closure:

- generates and typechecks without Snapback warnings or local shims;
- uses only the first-party provider/hooks for two dev identities;
- receives a second-client message over witnessed push with polling disabled;
- uses one membership declaration for reads, search, live invalidation, and
  strict asset authority;
- completes the authenticated asset lifecycle in dev and sessions modes;
- observes earlier buffered writes inside its mutation result; and
- tears down with no process, listener, connection, upload attempt, or secret
  sidecar left behind.

The retained must-not-regress inventory is exact generated result/argument
contracts, server-resolved authority and invalidation, atomic handler commit,
true non-durable ephemeral presence, structured diagnostics, strict asset
revocation, deterministic artifact identity, and a self-contained public npm
runtime. A smaller API or bundle does not qualify if it weakens any of those
facts.

Passing this packet does not fire the Phase 2 dry-well trigger. Re-run the
Diary 0050 Snapback arm against the released closure and append an immutable
dated entry; only the broader six-contract re-verification can inform the
dry-well judgment.

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

G0 (Stage 0, the sweep freeze) executed 2026-08-01: the frozen contracts,
kernel, neutral React and Expo shells, verbatim probe policy, evidence
schemas, expected-check-count manifests, assistance policy, target-lifecycle
rules, and names-only credentials preflight are retained under
`demos/improvement-sweep/`, digest-bound by `protocol/freeze.v1.json` and
verified by `scripts/verify-freeze.mjs`. Phase 1 froze no Snapback revision,
per this gate. Diaried sweep execution remains blocked on G1.

Assistance policy ratified 2026-08-01: the author ratified the G0-frozen
synthesized assistance policy
(`demos/improvement-sweep/protocol/assistance-policy.v1.json`,
`llp-0137-external-consumer-assistance-v1`) as written — ballot item 1,
verbatim "1 ratify" — closing
`issues/closed/20260801-0137-assistance-policy-synthesized-at-g0.md`. The
synthesis choices recorded there (source inspection = assistance event AND
posture-break finding; cross-arm knowledge inside the sweep not an event
while probe-directed imports are; 0102's independent-review block deferred
to Phase 2's freeze) are confirmed, not amended, so no policy re-freeze
semantics change; the ratification note itself lands per the freeze's
dated-amendment convention.

G1 (Stage 1, public package qualification) executed 2026-08-01 and
**passed** on the macOS/arm64 host: from a clean external directory outside
any checkout, the complete terminal `@expo/snapback-*` closure installed
from the public registry at immutable 0.1.7; all nine registry artifacts
byte-verified against the retained publication ledger
(`terminal-package-publication-0.1.7-fdd49db8.json`, sha256/sha1/sha512 and
live-registry dist all matching); every public subpath the arm uses
typechecked; a backend was scaffolded, generated, built, started,
inspected, exercised (a real handler in the qualified restricted-VM
runtime, structured result envelope, committed row observed live), and
stopped through package-owned commands only; exact package, binary
(sha256 = ledger `runtimeBinarySha256`, build stamp `fdd49db8…`),
runtime-readiness (`snapback.runtime-qualify.v1` ok), and bundle
(`inputsHash 545b9cee…`) identities are retained; teardown proven (no
processes, listeners, checkout-relative imports, or sibling dependencies —
one orphaned secret sidecar filed as a finding and removed). The Linux-host
half is covered by public-package-proof run 30692108019 (exact-mode,
green), cited rather than re-run. Capsule and evidence:
`demos/improvement-sweep/arms/g1-public-package-qualification/`; five
findings filed (template degraded-result advisory, stale authoring-loop
guide claim, run-capsule schema gap for G1 arms, missing packaged
runtime-readiness receipt/doc, orphaned `secret-read-root` sidecar) as
`issues/20260801-0137-g1-*.md`. This status note is the dated amendment
that re-froze `protocol/freeze.v1.json` (the plan document is inside the
freeze boundary). Diaried sweep arms are now unblocked by G1; G2/G3 gate
their tracks as frozen.

A2 (Stage 2, first diaried sweep arm — snapback-web, calibration budget)
executed 2026-08-01 and **completed**: all 12 frozen checks ran
(expectedChecks enforced) with **11 pass, 1 explicit contract-sanctioned
GAP (A2-08 retained protected history on the JS arm), 0 fail, 0 Stop**,
in sessions mode against the public 0.1.7 closure from a clean external
directory. Budget actuals: ~41 active minutes (5 orientation + 36 build)
and ~115 build-phase tool calls against the 4h/200 calibration ceilings
(records phase included, ~160 total); zero posture breaks; two
recorded assistance events (both undocumented-package-bytes reads, each
converted into a finding). Capsule, evidence, probe matrices, and app
sources: `demos/improvement-sweep/arms/a2-snapback-web/`; diary:
`diaries/0042-a2-group-chat-sweep.diary.md`. Eight findings filed
(`0137-a2-f1..f8`, tickets `issues/20260801-0137-a2-*.md` plus one
attachment to the owned JS-arm lease-custody GAP): headline defects are
the React-arm presence pair — generated `api.ephemeral.*` references
rejected by the prepared binding (schemaVersion v0/v1 mismatch) and the
managed presence room wedged at `connecting` whenever the same provider
owns any live query — which together make native presence unreachable
from the documented React path while the headless overlay lane passes
every ephemeral check. Capability findings: no self-scoped "my seats"
membership projection (forces an app-data mirror for the chat sidebar),
no principal-addressed admin revocation (kick/ban), and no bounded keyset
verbs in the packaged ctx.db chain. Differentiator watch (protect while
fixing): zero-durable-amplification ephemeral state verified against the
store version, blank-then-terminal-deny revocation on established handles
(~1.7s) with non-disclosing uniform denials, 33–37ms committed-row push,
commit-order (`_version`) determinism and stable cursors, and the
settlement envelope making keyed retries provably effect-free. This
status note is a dated amendment inside the freeze boundary; the freeze
was re-verified (and re-frozen for this plan digest) with the sweep's own
scripts in the landing commit.

A1 (Stage 2, second diaried sweep arm — snapback-web, deep budget)
executed 2026-08-01 and **completed**: all 13 frozen checks ran
(expectedChecks enforced) with **10 pass, 1 contract-sanctioned GAP
(A1-05 cold-boot protected render — the owned `sync.offline-js-arm-protected`
gap, A2-f8 cited not re-filed), 1 expected-refusal (A1-06: the documented
`SNAPBACK_RETENTION_NOT_RETAINABLE` fact fired exactly, carried on the
handle), 1 fail (A1-04: asset row attachment impossible on 0.1.7), 0
Stop**, in sessions mode against the public 0.1.7 closure, with the
offline legs run as genuinely cold child processes over an arm-owned
durable store. The local-first floor's shipped half held under real
sessions custody: durable offline queue (client-minted identity, monotonic
sequence), restart survival while offline, ordered exactly-once replay
(`{replayed:2,failed:0,remaining:0}`, no-op re-drain), second-device live
convergence, and honest retained cold boot (`freshness:'retained'`,
`connection:'stale'`) for the authority-independent subset. Budget
actuals: ~54 active minutes (19 orientation + 35 build) and ~118
build-phase tool calls against the 8h/400 deep ceilings (~175 with
records); zero posture breaks; four assistance events (packaged-bytes
reads, each converted into a finding, plus A2's persona recipe cited to
f6). Capsule, evidence, phase outputs, probes, and app sources:
`demos/improvement-sweep/arms/a1-snapback-web/`; diary:
`diaries/0043-a1-offline-notebook-sweep.diary.md`. Ten findings filed
(`0137-a1-f1..f10`, tickets `issues/20260801-0137-a1-*.md`): the headline
is the asset stack — an `assetRef` field makes its table unqueryable
(no AssetRef result-contract mapping), `ctx.assets.attach` admission never
reaches the commit validator (`SNAPBACK_ASSET_REF_UNVERIFIED` on every
variant; row attachment impossible on the public closure), and the
packaged asset client sends no bearer/protocol offer (sessions uploads
impossible) — plus the offline floor's reachability trio: the
retainability opt-in (`auth:'public'`/`authorityIndependent`/`retainable`)
is undocumented so sessions apps get zero offline by default, the React
arm projects no freshness/retention/outbox facts at all, and the LLP 0090
D3 rule means any queued intent blanks the retained render on the next
offline relaunch (filed as a design question against the frozen
Firebase/InstantDB bar, which renders cached rows plus queued writes
together). Differentiator watch (protect while fixing): refuse-with-
clarity retention facts with provably zero protected bytes at rest,
queue identity + ordered exactly-once drain, receipted versioned-seed
reset-install cleanup, byte-identical deterministic export, uniform
non-disclosing denials on read and subscribe, and the 6.6-second
full-suite loop. This status note is a dated amendment inside the freeze
boundary; the freeze was re-verified (and re-frozen for this plan digest)
with the sweep's own scripts in the landing commit.

A3 (Stage 2, third diaried sweep arm — snapback-web, deep budget)
executed 2026-08-01 and **completed**: all 12 frozen checks ran
(expectedChecks enforced) with **12 pass, 0 GAP, 0 fail, 0 Stop** (one
explicit in-check nonclaim: org-wide member search, sanctioned by
A3-05's gap lane), in sessions mode against the public 0.1.7 closure
from a clean external directory. The relational core carried the
Linear shape end to end: production-shaped versioned seed (14 issues,
teams/projects/labels/comments/activity, seeded invites), owner/member/
guest role matrix with uniform non-disclosing denials, declarative
gte/lte ranges, generated keyset pages with AEAD cursor custody
(malformed and cross-owner presentations refused byte-uniformly),
owner-partition transactional text search with highlights, one-snapshot
issue-detail composition with exact bounded aggregates, declared
optimistic projections retired by authoritative delivery (51ms overlay
lead), deterministic compare-and-move conflicts (exactly one commit per
revision, explicit rebase), 80–107ms second-client live deliveries, an
additive live schema evolution over the seeded data (same seed
identity, byte-equal counts, sessions uninterrupted), the app's own
six-query React board rendering under jsdom with a live DOM update,
and receipted reset-install cleanup — full suite wall 4.7s. Budget
actuals: ~44 active minutes (10 orientation + 34 build) and ~78
build-phase tool calls against the 8h/400 deep ceilings; zero posture
breaks; three assistance events (prior-arm recipes cited, one
packaged-bytes read, the evolution probes). Capsule, evidence, probes,
and app sources: `demos/improvement-sweep/arms/a3-snapback-web/`;
diary: `diaries/0044-a3-planning-board-sweep.diary.md`. Seven findings
filed (`0137-a3-f1..f7`, tickets `issues/20260801-0137-a3-*.md`): the
headline is the evolution pair — any attached live subscriber wedges
the watch-reload evolution permanently in `SNAPBACK_AUTH_MODE_PENDING`
(admission never reopens, restart refuses on the evolved artifacts;
connected clients are a collaborative app's steady state) and the
restart refusal is misattributed to a runtime/codegen mismatch with
harmful recovery advice — plus membership tables being unseedable and
un-resettable (fixture resets cannot retire authority), search
visibility unable to express membership partitions (org-wide issue
search inexpressible; owner-partition subset shipped), no structured
app-level refusal codes (conflict semantics collapse to
SNAPBACK_HANDLER_FAILED prose), generated keyset pages accepting only
principal-owner partitions (the org board list hand-rolls its cursor;
the LLP 0110/0131 resource-partition shape not yet exposed), and the
sessions schema-evolution path being entirely undocumented (guide-gap).
Differentiator watch (protect while fixing): zero-ceremony transactional
sequence allocation (ISS-n), settlement receipts on every mutation,
optimistic-overlay honesty, cursor custody, transactionally live
owner-partition search, sub-second unencumbered live evolution, the
4.7s full-suite loop, and uniform denials across read/subscribe/write/
cursor surfaces. This status note is a dated amendment inside the
freeze boundary; the freeze was re-verified (and re-frozen for this
plan digest) with the sweep's own scripts in the landing commit.

A4 (Stage 2, fourth diaried sweep arm — snapback-web, deep budget)
executed 2026-08-01 and **completed**: all 11 frozen checks ran
(expectedChecks enforced) with **9 pass, 2 fail, 0 GAP, 0 Stop** — both
fails are evidenced platform defects with complete positive evidence
around them, in sessions mode against the public 0.1.7 closure from a
clean external directory. The event core carried the Partiful shape:
seeded capacity fixture (12 seats), host/cohost/guest/outsider role
matrix with uniform denials, anonymous public preview serving exactly
the nine-field projection (address/notes/codes/guest identities
byte-probed absent), atomic attributed invitation deep-link entry (one
mutation: seat + consume + attributed RSVP + receipt), a two-actor
capacity race committing exactly one contender and booking exactly
12/12 (upgrade and plus-one-limit refusals held; anonymous preview
agreed), 41–56ms second-client live wall/count deliveries with
zero-durable-amplification ephemeral presence, a REAL packaged image
pipeline (strip + card/thumb renditions + strict private/no-store
delivery + stable digest + deletion + logged-out-session 401 on the
very next read), a deterministic scheduled reminder (one receipted
idempotent delivery across scheduled/re-tick/manual lanes), and
receipted reset-install cleanup (config unset, assets retired, seats
self-removed, literal fixture restored) — full suite wall 17.7s.
Budget actuals: ~13 min orientation + ~47 min build and ~120
build-phase tool calls against the 8h/400 deep ceilings; zero posture
breaks; four assistance events (prior-arm recipes cited to their
owning findings; packaged-bytes reads converted into findings).
Capsule, evidence, probes, and app sources:
`demos/improvement-sweep/arms/a4-snapback-web/`; diary:
`diaries/0045-a4-events-sweep.diary.md`. Seven findings filed
(`0137-a4-f1..f7`, tickets `issues/20260801-0137-a4-*.md`): the
headline is **f1 — outbound notification effects are unauthorable on
packaged 0.1.7** (the A4-10 fail; a packaging-era regression vs the
0102 repo-source arm, which passed the same effect legs): the
documented module action form refuses every export at generation
(BUNDLE_UNSUPPORTED_EXPORT) while the loader demands the export
(SNAPBACK_HANDLER_EXPORT_MISSING), and the undocumented inline form
refuses global fetch at generation while ctx.fetch dies at runtime as
unknown host call host.fetch — with the egress opt-in set at both
boundaries. The asset chain is the other fail (A4-07): typed attach
still refuses (a1-f2 re-verified, cited) and **f3 — the documented
pasteable lanes (signed-url issuance, public-immutable route) are
absent from the packaged runtime** (only their kind names exist), so
no non-owner viewer class exists for any asset. Also filed: f2
`snapback dev` exits 1 printing nothing when the managed loop's first
result is not ok (the failure envelope is swallowed); f4 the everyMs
catch-up run executes with trusted time at the epoch-0 nominal
(Succeeded run, silently no-opped due-scan; receipt retained); f5
nested-mutation SNAPBACK_AUTH_PERMISSION_DENIED collapses to
SNAPBACK_HANDLER_FAILED through the action boundary; f6 no anonymous
packaged client for public queries outside a browser (verbatim
0102-epoch repeat); f7 config API request shapes undocumented (also a
0102-epoch repeat). Differentiator watch (protect while fixing):
serialized-commit capacity correctness with exact-full booking, atomic
attributed invitation entry, per-request asset re-authorization with
immediate session-revocation denial, the exact public-projection
boundary on sessions servers, ephemeral presence with zero durable
amplification, the deterministic scheduler seam with append-only run
receipts, and the 17.7s full-suite loop. This status note is a dated
amendment inside the freeze boundary; the freeze was re-verified (and
re-frozen for this plan digest) with the sweep's own scripts in the
landing commit.

A5 (Stage 2, fifth diaried sweep arm — snapback-web, deep budget)
executed 2026-08-01 and **completed**: all 13 frozen checks ran
(expectedChecks enforced) with **11 pass, 1 explicit GAP, 1 fail, 0
Stop**, in sessions mode against the public 0.1.7 closure from a clean
external directory — full suite wall 5.0s. The research-room core
carried the shape end to end: seeded corpus with content-hash fixture
identity and a stored (never retrieval-claimed) 32-dim embeddings
fixture; a resumable staged assistant (one serialized mutation per
pipeline stage looped by an action) streaming four durable progress
commits to the second member at 35–85ms before terminal completion;
transactionally validated citations (invalid citation refused at
commit); confirmed cancellation fencing ALL FOUR late durable-patch
lanes with append-only fenced receipts and a byte-stable terminal
record; idempotent re-ask + a concurrent two-client ask converging on
one question; the five-outcome matrix (complete/cancelled/failed/
timed-out/ambiguous) simultaneously distinct with the retryable-vs-
hard-terminal split enforced; and receipted reset-install cleanup. The
**headline reversal of the frozen Diary 0031 blocker**: the sessions +
streamed-actions composition that product-blocked the 0102-epoch arm
now works on the packaged closure — `bounded_response_stream_v1`
artifacts admit, `ctx.streamAttempt` custody (lease, terminal winner,
`effectMayHaveExecuted`, idempotent rejoin) and the `ctx.fetchStream`
one-pull reader run end to end, headers/secrets staged via
`ctx.secrets` reach the upstream, and the A5-12 scheduled refresh ran
the full documented pattern against a strict-auth local provider with
the canary absent from every client-visible surface. The GAP is vector
retrieval (A5-05 per its own check wording: capability-index
design-only row + LLP 0132 Accepted-but-unimplemented cited, fixture
stored, nonclaim recorded). The fail is A5-02's collaborative
file-sharing leg: the seated member cannot download a shared source
(a1-f2/a1-f3/a4-f3 chain re-verified, cited not re-filed); the
octet-stream accept lane uploading markdown bytes is a working a1-f10
workaround (dated ticket note). Budget actuals: ~14 min orientation +
~40 min build and ~78 build-phase tool calls against the 8h/400 deep
ceilings; zero posture breaks; one assistance event (prior-arm recipes
cited to their owning findings). Capsule, evidence, probe app, and
sources: `demos/improvement-sweep/arms/a5-snapback-web/`; diary:
`diaries/0046-a5-ai-research-room-sweep.diary.md`. Three findings
filed (`0137-a5-f1..f3`, tickets `issues/20260801-0137-a5-*.md`): the
headline is **f1 — the streamed lane is the only working action
egress** (plain `ctx.fetch` re-verified dead as unknown host call
host.fetch while fetchStream works, so a4-f1's "every action form"
NARROWS — dated note on the A4 ticket — and the guide teaches the
broken lane first); f2 the `v.array` table-field refusal names the Json
primitive but not the documented working `v.json()` column type; f3
guide-gap: the inline_handler_v1 subset (dynamic computed member
access, empty writes, allowed globals) is discoverable only by
generation refusal. Also: a dated refinement on a4-f4 (the epoch-0
catch-up clock applies to the ACTION only; nested mutations see real
trusted time — two clocks in one run). Differentiator watch (protect
while fixing): the sessions+streamed-actions composition itself (the
0031 reversal), serialized per-stage mutations making workflow fencing
correct with live composed-thread delivery, receipted cancellation
fences, clean secret custody where frozen Convex evidence has its
Stop-class argv/wildcard defect, the 5.0s full-suite loop, and the
seed-version ledger refusing changed bytes under a reused identity.
This status note is a dated amendment inside the freeze boundary; the
freeze was re-verified (and re-frozen for this plan digest) with the
sweep's own scripts in the landing commit.

A6 (Stage 2, sixth and final diaried web sweep arm — snapback-web, deep
budget) executed 2026-08-01 and **completed**: all 10 frozen checks ran
(expectedChecks enforced) with **10 pass, 0 GAP, 0 fail, 0 Stop — the
sweep's first fully green arm** — in sessions mode against the public
0.1.7 closure from a clean external directory, full suite wall 5.0s.
The operations-ledger core carried the new shape end to end: a
two-client six-way concurrent-create barrier allocating JOB-4..JOB-9
dense and duplicate-free from a three-line serialized counter (the
frozen Diary 0028/0034 "contention-safe sequence allocation" wish, with
dedupe replay burning nothing); bounded child lists (newest-20 audit
window over a 25-row trail) with dashboard aggregates equal to an
export-derived recount; **jobs_one_off_v1 proven end to end
externally** — mutation-transactional `ctx.jobs.enqueue` with bounded
`enqueues` facts on the confirmed envelope, producer association,
premature drain running nothing, injected-clock drain executing exactly
once, terminal no-rerun — beside deterministic everyMs maintenance
(a4-f4 epoch-0 nominal cited); claim/release/retry-claim/lease-timeout/
cancellation each leaving append-only receipts with byte-stable
prefixes; concurrent claims resolving to one owner with the PRIOR
owner's stale-fence completion and release both fenced and receipted;
idempotent external dispatch over the streamed lane (a5-f1 cited) with
the strict provider seeing exactly one request per key across retry and
a two-actor race and the canary secret absent from five client-visible
surfaces; a 64–67ms live ranged dashboard with an exact narrow/wide
range partition; and an export/reset/restore round-trip with id-free
digest equality plus receipted reset-install cleanup. Budget actuals:
~42 min orientation + ~38 min build and ~100 build-phase tool calls
against the 8h/400 deep ceilings; zero posture breaks; two assistance
events (prior-arm recipes and packaged-artifact reads, each pinned to
owning findings). Capsule, evidence, probe artifacts, and app sources:
`demos/improvement-sweep/arms/a6-snapback-web/`; diary:
`diaries/0047-a6-ops-ledger-sweep.diary.md`. Three findings filed
(`0137-a6-f1..f3`, tickets `issues/20260801-0137-a6-*.md`): the
headline is **f1 — `defineJobStatusQuery` makes the whole app
unbootable** (codegen emits a plan referencing `_snapback_jobs`; the
server refuses the manifest at load with
SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID while the runtime table is
`_snapback_jobs_v1`; one declared line, no boot — worked around via the
admin job route); f2 guide-gap: the jobs admin custody (secret-read
lease mint, `x-snapback-secret-read-lease`, the ready-file-bound
`snapback secret-read-mint` CLI) and the enqueue/drain vocabulary are
discoverable only from binary strings and error ladders, and the
"acknowledged by codegen" capability sentence reads as an instruction
that refuses; f3 the versioned reset-install strands connected clients
(terminal SNAPBACK_AUTH_STREAM_RESET out of arbitrary awaits, stale
tokens SNAPBACK_AUTH_REQUIRED, fresh sign-ins minting NEW principals)
with no client terminal-state surface and no guide coverage — the
authority posture itself is correct and must not regress.
Differentiator watch (protect while fixing): transactional enqueue
with receipt-level producer facts (the frozen LLP 0121 Convex-verdict
capability, now externally real), zero-ceremony contention-safe
sequence allocation, fence receipts as authoritative history (beyond
frozen SpacetimeDB reducer-rejection evidence), provider-boundary
idempotency with clean secret custody, the deterministic
tick/drain/reset seams making a 10-check OPERATIONS suite green in
5.0s, and app-authored export/restore with digest proof. This status
note is a dated amendment inside the freeze boundary; the freeze was
re-verified (and re-frozen for this plan digest) with the sweep's own
scripts in the landing commit.

Track B — A1 Expo iOS (Stage 4, first Expo sweep arm — snapback-expo,
deep budget) executed 2026-08-01 and **completed**: all 10 a1-applicable
frozen EXPO checks ran (expectedChecks enforced from the expo-receipt
manifest) with **7 pass, 2 contract-sanctioned GAP, 1 evidenced-defect
fail, 0 Stop** on an iPhone 17 Pro simulator (iOS 26.3), release build
(`expo run:ios --configuration Release`, embedded bundle, Hermes), public
0.1.7 closure from a clean external directory, sessions mode with the
email-code exchange executed on-device, and the supported local bridge
per the frozen Track B rule. The G3 pin (frozen neutral-expo shell
versions Expo 57.0.9 / RN 0.86.2 / React 19.2.3; the guide's
`clients/react-expo.md` path; release build mode) was recorded before arm
work. What carried over cleanly: Metro bundled the closure with zero
resolver configuration (deliberately bundler-safe packaging), the same
generated-refs + provider + hook wiring as web ran unchanged on Hermes,
second-device commits rendered on-device in 33–42ms, uniform
non-disclosing denials held on every on-device surface, background/
foreground caught up missed commits, network loss kept retained rows
under an honest non-live fact, and the receipted versioned reset-install
cleanup ran identically from the mobile harness — the 10-check on-device
suite completes in 61 seconds. The GAPs are the mobile local-first floor:
EXPO-06 (retained cold boot unclaimed — the default rqs store resolves to
the in-memory arm on RN; the cold restart itself is clean and self-heals)
and EXPO-07 (queue unclaimed — and the documented `offlineQueue` opt-in
*cannot* engage because the connectivity classification requires
`instanceof TypeError` while Expo fetch rejects plain `Error`; node
control with identical options queues). The fail is EXPO-10:
`replaceBearerToken` downgrade rotation rejects with AggregateError
"completed with lifecycle failures" (inner error = the expected denial),
surfaces no denial fact on the query/hook, and rotate-back never
re-subscribes attached handles (React provider: connection wedged
`disconnected` until process restart; node control: public handle
live-labeled with zero rows) — logout and predecessor-data retirement
themselves passed. Seven findings filed (`0137-a1expo-f1..f7`, tickets
`issues/20260801-0137-a1expo-*.md`): the WebCrypto prerequisite (no
`globalThis.crypto` on RN/Hermes; session establishment impossible
without an undocumented consumer polyfill), the queue error-class defect,
the missing on-device durable store arm (LLP 0129's default-persistence
promise does not reach this carrier), the rotation wedge, the hosted
mobile availability GAP (receipt.hostedAvailability), the react-expo
guide page teaching a checkpoint-era hook API absent from the package,
and the RN steady-state connection cycling live→stale (~2s loop) with the
retainable public query blanking after the first cycle while deliveries
still land in 33–42ms. Android: honest not-run GAP — the host has an
emulator binary and one AVD but no JDK, so `expo run:android`/gradle
cannot execute; no android receipt is minted and nothing iOS claims
Android behavior (LLP 0064). Physical-device: not-run, separately
reported production gate. Budget actuals: ~18 min orientation + ~38 min
build (three release builds: initial + two defect-workaround rebuilds)
and ~100 build-phase tool calls against the 8h/400 deep ceilings; zero
posture breaks; two assistance events (prior-arm program-records
adoption; packaged-bytes reads, each converted into a finding).
Receipt, capsule, evidence (including on-device screenshots and the
witness-event stream), and app sources:
`demos/improvement-sweep/arms/a1-snapback-expo-ios/`; diary: Track B
entry appended to `diaries/0043-a1-offline-notebook-sweep.diary.md`.
Differentiator watch (protect while fixing the mobile floor): the
33–42ms on-device push, refuse-with-clarity retention honesty (no
protected bytes at rest by construction), blank-before-successor
rotation ordering, bundler-safe packaging, and the 61-second receipt
loop. This status note is a dated amendment inside the freeze boundary;
the freeze was re-verified (and re-frozen for this plan digest) with the
sweep's own scripts in the landing commit.

Track B — A4 Expo iOS (Stage 4, second and final planned Expo sweep arm —
snapback-expo, deep budget) executed 2026-08-01 and **completed**: all 12
a4-applicable frozen EXPO checks ran (expectedChecks enforced from the
expo-receipt manifest) with **8 pass, 3 GAP, 1 evidenced-defect fail,
0 Stop** on the same iPhone 17 Pro simulator (iOS 26.3), release build,
public 0.1.7 closure from a clean external directory, sessions mode with
the email-code exchange executed on-device, backend sources adopted
verbatim from the a4-snapback-web arm, and the supported local bridge per
the frozen Track B rule. The a1-expo arm's recipes prepaid the carrier
tax (polyfill, harness, custody, driver skeleton): one native build,
~27 minutes install → green receipt, 110-second suite. New ground this
arm proved: the **A4 invitation deep link as a real OS-level flow**
(`simctl openurl` → running release app → one authority-creating
redemption settling `{role, inviteCode, invitedByName,
enteredVia:'deep-link'}`, invite consumed, replay refused, roster
attribution independently verified) and the **image pipeline from the
phone** (on-device raw TUS upload with on-device sha256, async card/thumb
renditions, strict no-store per-request-authorized delivery read back
on-device, the RN `Image` component rendering through the authorized byte
lane, and a served canonical digest byte-identical to the web arm's for
the same fixture). Second-device wall posts and recomputed seat counts
rendered on-device in ≤122ms. The GAPs: EXPO-06/EXPO-07 (the mobile
local-first floor, owned by 0137-a1expo-f3/f2 — f2 re-verified here) and
EXPO-09 (**no push-notification boundary on 0.1.7** — capability manifest
`notifications:false`, no device-token/APNs/expo-notifications lane in
closure or guide, and the app-authored bridge unauthorable because the
outbound effect lane is broken on the pinned packages; the `ctx.fetch`
fix `117dcae2` is post-publication main). The fail is EXPO-10: the
0137-a1expo-f4 rotation wedge reproduced unchanged (downgrade rotation
rejects with the lifecycle-failures AggregateError, the successor denial
never reaches the hook, rotate-back never re-subscribes — this arm's
wedge shape presents queries `ready` with zero rows under a
`disconnected` connection); logout and predecessor-data retirement
passed. The a1-f2/a4-f3 non-owner asset hole was re-verified from the
device (typed attach `SNAPBACK_ASSET_REF_UNVERIFIED`, seated-guest strict
read 403): the on-device flyer render is owner-only until the
asset-sharing chain closes. Two findings filed (`0137-a4expo-f1..f2`,
tickets `issues/20260801-0137-a4expo-*.md`): the mobile push-boundary GAP
and the deep-link scheme-approval guide-gap (iOS's one-time 'Open in?'
dialog silently defeats headless `simctl openurl`; the working
schemeapproval-plist pre-authorization recipe is knowledge the guide
should carry). Dated re-verification/narrowing notes appended to the
a1expo f2/f4/f7 tickets — notably **f7 narrowed**: the indefinite ~2s
connection cycling did not reproduce on this all-protected-query surface
(no retainable public query), consistent with the retainable re-prime
suspicion. Android: honest not-run GAP (JDK absence re-verified live); no
android receipt is minted (LLP 0064). Physical-device: not-run,
separately reported production gate. Budget actuals: ~23 min orientation
+ ~27 min build (single release build; three receipt-driver iterations)
and ~55 build-phase tool calls against the 8h/400 deep ceilings; zero
posture breaks; two assistance events (prior-arm program-records
adoption; the OS-level schemeapproval discovery, converted into finding
a4expo-f2). Receipt, capsule, evidence (screenshots incl. the on-device
flyer render, witness-event stream), and app sources:
`demos/improvement-sweep/arms/a4-snapback-expo-ios/`; diary: Track B
entry appended to `diaries/0045-a4-events-sweep.diary.md`.
Differentiator watch (protect while fixing): the atomic deep-link
redemption settlement, ≤122ms second-device push under the heavier A4
queries, cross-carrier canonical content identity, the uniform denial
surface (anonymous projection, outsider, anonymous bytes, post-rotation,
post-cleanup), and the 110-second receipt loop. This status note is a
dated amendment inside the freeze boundary; the freeze was re-verified
with the sweep's own scripts in the landing commit.
Track C — Exact multi-platform graduation (Stage 5/6) readiness
assessment executed 2026-08-01: **honest program GAP — the Exact Native
surface is not ready for the frozen A1 contract**, recorded per this
plan's own rule rather than stretched into a run. What is real: the
`exact-native/ios` and `exact-native/android` **Parity receipts exist
for the Partitime workload** (exact repo
`docs/reports/exact-native/partitime-{ios,android}.json`, 2026-07-21,
all twelve LLP 0064 Parity facts, imported by the Partitime-specific
`step2-exact-native.mjs` gate), and Contract/web for A1 is available
today (packaged `@expo/snapback-contract`, codegen contract modules,
shipped guide page) but was not run — Track C is one three-surface
exercise and two of three surfaces are unready for this app. The four
precise unready gates (full citations in
`demos/improvement-sweep/arms/a1-exact-graduation/gap-record.json` and
ticket `issues/shelved/20260801-0137-track-c-exact-unready-gate.md`): (1)
plan-tier expressibility — A1's backend is JS mutations/live queries
over `ctx.membership.*`, `requireRole`, unique-key idempotent create,
revision patches, and `ctx.assets.attach`, while LLP 0064 §4 rules
server-only handlers inadmissible for deterministic local execution and
the exact-side Rust codegen has zero membership/JS-handler support; (2)
the generated Rust app modules pin Snapback authority `b79c695f`
(2026-07-20) — an epoch behind the 0.1.7 closure the sweep runs
against; (3) no app-agnostic onboarding path — per-app vendored
artifacts, a hand-composed carrier crate per app
(`exact-partitime-carrier`), an app-named capture harness, and a
Partitime-only import gate make carrying A1 a build-the-surface
project, not a run; (4) no native asset surface for A1-04 and no
sessions-custody story for the native carrier (and the asset stack is
defective even on the web closure — 0137-a1-f1/f2/f3). Recorded
explicitly: neither this sweep's `a1-snapback-expo-ios` Online receipt
nor any Contract-on-Hermes instrument substitutes for an Exact Native
profile, and the Partitime Parity receipts do not transfer to the A1
workload (LLP 0064 §7). Track C remains a separate successor gate with
named reopening conditions in the ticket; the sweep report is not
delayed for it. This status note is a dated amendment inside the freeze
boundary; the freeze was re-verified (and re-frozen for this plan

A1/Firebase PROBE (Stage 3, first competitor probe — firebase, web,
reference observations only) executed 2026-08-01 and **completed**:
justified under probe rule 2 (no frozen evidence covers A1's local-first
floor; triggering findings 0137-a1-f4/f5/f6 and 0137-a1expo-f2/f3/f7),
timeboxed inside the deep ceiling (~13 active minutes, ~27 build-phase
tool calls), official provider paths only (firebase 12.17.0 modular SDK
with persistentLocalCache + anonymous Auth, official Emulator Suite under
the demo- project prefix, real Chrome persistent profiles with backend
routes aborted for the offline legs). Setup observation: the live
snapback-probe project has Anonymous auth and Firestore console-enabled
but rules locked (authenticated read PERMISSION_DENIED; deployment is
owner-credentialed), so the probe ran the emulator fallback and hosted
behavior stays unprobed. All five reference dimensions observed with
timings: cold-boot retained render of protected rows in 26ms with
offline-restored auth; queued create+update rendered WITH cached rows
and durable across a browser restart while still offline (the exact
render LLP 0090 D3 forecloses, a1-f6); honest second-client
no-remote-commit; reconnect flush/settle by 75ms with author-supplied
idempotency (no settlement envelope surface); silent
deterministic-by-server-order LWW conflicts with byte-identical
convergence. Counter-observations the reference lacks: one fromCache
boolean is the whole honesty surface, no retention/refusal facts, no
enumerable outbox, no custody boundary for protected data at rest, and a
silent empty-memory-cache fallback when the persistence lease is
contended (forceOwnership required). Capsule (PROBE-labeled, probeSlice
declared), reference-observations doc, and evidence:
`demos/improvement-sweep/probes/a1-firebase-web/`; dated PROBE entry
appended to `diaries/0043-a1-offline-notebook-sweep.diary.md`. Cleanup
proven (SDK-deleted probe docs, emulators/server stopped, ports free,
browser profiles deleted, live project never written). No ranking is
claimed; the observations exist to shape the a1-f4/f5/f6 and
a1expo-f2/f3/f7 fixes. This status note is a dated amendment inside the
freeze boundary; the freeze was re-verified (and re-frozen for this plan
digest) with the sweep's own scripts in the landing commit.

Stage 6 (synthesis) executed 2026-08-01. The sweep report and gap
ledger land at `demos/improvement-sweep/reports/sweep-report.md` and
`demos/improvement-sweep/reports/gap-ledger.v1.json`: 52 findings
across six web arms, two Expo iOS arms, the G1 qualification, and the
A1/Firebase probe — 21 fixed on main by the between-arms fix loop
(awaiting the next release cut; 0.1.7 stays the arms' pinned
baseline), 31 open, zero Stop-class, zero architectural rethink
triggers. The longitudinal comparison records three frozen-epoch
verdicts reversed on the merits (Diary 0031 research-room, LLP 0121
Dispatch scheduling, external-package lifecycle), two regressions
caught (outbound effect lane — fixed on main; bounded ctx.db verbs —
open), and two 0102-epoch repeats still unpaid (anonymous public lane,
config shapes). Track B's Android halves and Track C remain honest
program GAPs. **Dry-well assessment: the trigger does not fire** — the
default signal cannot even be evaluated until a closure containing the
fixes ships and a re-verification pass runs; Stage 7 stays deferred
per Charlie's 2026-08-01 directive. Reassessment condition recorded in
the report. This status note is a dated amendment inside the freeze
boundary; the freeze was re-verified (re-frozen for this plan digest)
with the sweep's own scripts in the landing commit.

The 0.1.8 re-verification pass executed 2026-08-01 (later), per the
fix-loop rule. 0.1.8 published fast-path from main `5d5c6b71`
(retained ledger `fastpath-ledger-0.1.8-5d5c6b7183af`); every
previously fixed-on-main finding's affected acceptance fact was re-run
from external-consumer posture against the public registry: **22 facts,
21 pass, 1 gap, 0 regressions** (capsule
`demos/improvement-sweep/arms/reverify-0.1.8/`; dated entries in
diaries 0042–0047; ledger and report dispositions updated to
verified-in-0.1.8). The gap: the a1-f5 React offline projections are
verified live, but the cold-offline-boot React witness is unreachable
externally (binding preparation fetches) — ticketed, with one further
papercut (jobStatus degraded advisory). The g1-f3 capsule-schema debt
was retired by a dated prospective G0 amendment (contract-free
qualification/re-verification arms) and the freeze rewritten in the
same landing. The dry-well default signal is now evaluable: this
targeted pass produced no table-stakes and no Stop-class findings, but
the open backlog (32 tickets, including the asset sharing chain and the
mobile floor) keeps the trigger unfired; the next full re-verification
sweep across the six contracts after those close is the reassessment
point.
