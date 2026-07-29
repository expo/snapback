# LLP 0102: Seven-backend, five-app bakeoff

**Type:** Plan
**Status:** Accepted
**Systems:** Competitive evaluation, Demo applications, Developer experience, Data modeling, Realtime, Offline sync, Auth, Actions, Deployment, Operations, Testing, Documentation
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (author-approved target-access amendment permits free/local and shared hosted targets with arm-specific namespaces, baseline preservation, scoped cleanup, and explicit evidence-confidence limits). 2026-07-28 (accepted for execution after resolving reviewer, plan/region, identity, target-lifecycle, and performance defaults; initial draft: staged calibration, remediation, deep round, final ranking, and Snapback improvement synthesis)
**Related:** LLP 0000, LLP 0010, LLP 0015, LLP 0016, LLP 0035, LLP 0063, LLP 0074, LLP 0075, LLP 0076, LLP 0101, Diary 0016, Diary 0017, Diary 0018

## Summary

Run a staged bakeoff across seven application backends:

1. Snapback;
2. Convex;
3. Supabase;
4. Firebase, using Firestore plus the ordinary Firebase application services;
5. InstantDB;
6. SpacetimeDB; and
7. Appwrite.

The program exists primarily to improve Snapback. It also produces an honest,
current answer to a separate question: which backend would the builder choose
for a new application after using all seven?

The bakeoff uses five product shapes:

1. an offline shared todo application;
2. realtime group chat;
3. a Linear-shaped issue tracker;
4. a Partiful-shaped event application; and
5. a collaborative AI research room.

Todo and Chat form a calibration round. Their evidence is frozen before a
Snapback remediation tranche. Linear, Partiful, and Research Room then form the
deep round. A final confirmation rerun measures the improved Snapback without
rewriting the original evidence.

The final report contains four things that must not be collapsed into one:

- product completeness;
- first-hour and total authoring cost;
- correctness and evidence confidence; and
- a weighted holistic composite representing the builder's go-to choice today.

Architectural potential is reported separately and never changes the current
product ranking.

## Purpose and research questions

The primary research question is:

> What general changes would make Snapback a better backend to build real
> applications with?

The comparison also asks:

- Where does Snapback make difficult correctness properties substantially
  easier?
- Where does Snapback impose ceremony before delivering value?
- Which outcomes are easier or better on another backend?
- Which Snapback gaps are bugs, missing capabilities, experience problems,
  documentation failures, or operational omissions?
- Can Snapback match a competitor's user-visible result through a
  Snapback-native design without copying the competitor's implementation?
- After all five applications, which backend is the builder's go-to choice for
  each app and overall?
- Is the overall result robust to reasonable changes in scoring weights?

This is not a marketing exercise. Snapback is allowed to lose, and a missing
Snapback capability is useful evidence.

## Authority and precedence

This Plan owns the seven-backend program, app ordering, diary template,
comparison rubric, remediation loop, and final synthesis.

It does not replace:

- LLP 0010's Snapback acceptance discipline;
- LLP 0015's Snapback demo-corpus rules;
- LLP 0016's diary-to-change ownership and immutable-diary policy;
- LLP 0035's performance-measurement requirements;
- LLP 0063's existing platform roadmap;
- LLP 0074's Match / Differentiate / Refuse classification; or
- LLP 0075's accepted Convex-specific checkpoint protocol.

Accepted subsystem authorities govern Snapback semantics. This Plan may expose
a conflict or propose a course correction, but it cannot silently weaken an
accepted correctness, authorization, or capability boundary.

LLP 0075 remains the authority for its exact frozen AI-chat checkpoint. This
Plan reuses its evidence principles but does not amend its fixture, margins, or
adjudication.

## 2026-07-28 target-access amendment

Charlie authorized shared and free-tier targets after Stage 0 found that the
available credentials bind existing Supabase, Convex, and InstantDB targets
rather than account-level provisioning. This prospective amendment replaces
fresh-hosted-project creation as a universal gate:

- an arm may use a fresh free/local target, a fresh free hosted target, or an
  existing shared hosted target;
- a shared target must use a unique arm namespace derived from provider, app,
  round, and attempt id;
- before any shared-target write, retain a redacted baseline inventory and
  prove that every planned mutation and cleanup operation is namespace-scoped;
- cleanup removes only arm-owned records, functions, files, schedules, auth
  principals, and configuration. The shared target itself is never deleted;
- a post-cleanup probe must prove the arm namespace absent and the unrelated
  baseline unchanged. If the provider cannot support that proof, record a
  cleanup GAP and do not perform the unsafe operation;
- hosted access that remains unavailable is environment/credential evidence,
  not a product failure. The arm may proceed on the provider's official local
  or emulator path and must lower target-identity, deployment, operations,
  cost, and artifact-reproducibility confidence as applicable; and
- shared-target history, warm state, unknown plan, and noisy-neighbor effects
  are disclosed. Performance and cost from such a target are not compared as
  if they came from an isolated deployment.

Native development identities or non-deliverable namespace-scoped test
identities may stand in for inbox-backed personas when that is the provider's
ordinary local/emulator path. Any acceptance fact that specifically requires
email delivery remains unproven unless delivery is witnessed.

The amendment changes access and evidence confidence, not application facts,
Stop classes, authorization expectations, native-path requirements, or the
rule against a lowest-common-denominator backend abstraction.

## Provider profiles

Every arm uses the provider's recommended complete application path rather than
a portable lowest-common-denominator gateway.

The intended profiles, to be verified and pinned before each round, are:

| Backend | Local development profile | Hosted profile |
| --- | --- | --- |
| Snapback | packaged local SQLite + Ibex target | first honestly complete supported hosted profile |
| Convex | official local development when applicable | free isolated or namespace-isolated shared managed deployment |
| Supabase | official local CLI stack | free isolated or namespace-isolated shared managed project |
| Firebase | Local Emulator Suite | free isolated Firebase project when credentials are available |
| InstantDB | official local path if one is supported; otherwise explicit GAP | free isolated or namespace-isolated shared managed application |
| SpacetimeDB | standalone server | free Maincloud database/module when credentials are available |
| Appwrite | official local container stack | free Appwrite Cloud project when credentials are available |

The inventory at round freeze records the exact product, version, plan, region,
client packages, CLI, hosting topology, auth provider, and official
documentation URLs. If a profile above is no longer current, the official
recommended profile replaces it prospectively before evidence is revealed.

Unsupported local or hosted operation remains an explicit product fact. The
comparison must not construct a custom substitute and then attribute it to the
provider.

## Common implementation rule

The applications share user-visible product facts and acceptance scenarios,
not a backend abstraction.

Each backend may use its idiomatic:

- schema and data model;
- functions, transactions, rules, and policies;
- subscriptions, presence, and offline facilities;
- auth and authorization model;
- storage, search, jobs, and deployment facilities; and
- generated clients and framework bindings.

A frozen neutral React web shell supplies visual structure, accessibility
labels, test identifiers, and navigation. Provider-specific data code remains
visible and is counted. A generic gateway, poller, or normalized provider
interface is forbidden unless it is genuinely required by that backend; when
required, it is application-authored glue and counts against that arm.

Provider-specific implementations may differ internally. They must converge on
the same observable product behavior.

## The five applications

### App 1: Offline shared Todo

Todo is the calibration floor. It tests whether ordinary work is ordinary.

Required product facts:

- two authenticated members share a workspace; an outsider cannot read it;
- lists contain ordered tasks with title, completion, assignee, and due date;
- members can create, edit, complete, reopen, reorder, and delete tasks;
- two connected clients observe authoritative changes without refresh;
- a previously opened client boots with retained data while offline;
- that client can queue at least one create and one update while offline;
- reconnect settles queued work without duplication;
- a concurrent conflicting edit has a visible, documented outcome;
- logout removes protected retained data according to the provider's contract;
- seeded data and cleanup are deterministic.

Todo deliberately excludes files, semantic search, external effects, and
complex background work.

### App 2: Realtime group chat

Chat is the calibration stress case for append-heavy data and transient state.

Required product facts:

- authenticated users join authorized public and private channels;
- an outsider cannot read or subscribe to a private channel;
- messages have server-authoritative identity, author, and ordering;
- history uses stable cursor pagination;
- a second client sees new messages through provider-native realtime;
- typing and presence use an ephemeral path when the provider has one;
- reconnect restores an authoritative channel view without duplication;
- previously loaded history remains readable offline where supported;
- unread state remains correct across two clients;
- concurrent sends preserve both messages and deterministic ordering;
- logout or membership removal stops future protected delivery;
- seeded data and cleanup are deterministic.

The calibration version is text-only. Attachments and search are exercised by
the deep applications so an obvious storage gap does not dominate the first
round.

### App 3: Linear-shaped issue tracker

Required product facts:

- organizations contain teams, projects, members, issues, labels, and comments;
- roles distinguish organization owner, team member, and outsider;
- issue lists support indexed filters, stable pagination, and deterministic
  ordering over a nontrivial seed;
- issue detail composes related project, assignee, labels, comments, and
  activity;
- status, priority, assignee, and board position update optimistically where
  supported and reconcile authoritatively;
- two users concurrently editing or moving one issue receive a documented
  conflict outcome;
- comments and activity update live;
- full-text issue search is implemented through the provider's ordinary
  supported path or recorded as a GAP;
- offline retained views and queued edits are exercised where supported;
- schema evolution adds one indexed field without losing production-shaped
  data.

### App 4: Partiful-shaped event application

Required product facts:

- a host creates and edits an event with a public preview and private controls;
- guests join through an invitation and RSVP yes/no/maybe with a plus-one count;
- host, cohost, guest, and outsider have distinct read/write authority;
- guest-list visibility can differ from public event visibility;
- capacity is enforced under concurrent RSVP contention;
- wall posts and RSVP counts update live during a burst;
- event art exercises authenticated asset upload and delivery;
- scheduled reminders produce an inspectable run and idempotent delivery
  attempt;
- one provider-style external notification effect has explicit retry and
  ambiguous-outcome handling;
- revocation or event removal stops protected delivery and handles retained
  data honestly;
- seeded data and cleanup are deterministic.

External email/SMS delivery may use a deterministic fake during local
acceptance, but the hosted profile must also prove the provider boundary and
secret/configuration path. A fake never counts as hosted delivery.

### App 5: Collaborative AI research room

Required product facts:

- authenticated members create a room and upload source files;
- file metadata, ownership, authorization, and deletion are enforced;
- sources support keyword search and semantic retrieval through the provider's
  ordinary path or an explicit GAP;
- a member asks a question and receives multiple authoritative streamed
  progress updates before terminal completion;
- the answer retains citations to source records;
- cancellation prevents late durable patches;
- retry is idempotent and does not duplicate questions or answers;
- complete, failed, cancelled, timed-out, and ambiguous effects remain
  distinguishable;
- a second member observes progress live;
- an outsider cannot retrieve sources, search results, or answer progress;
- one scheduled refresh fetches an external source and records durable
  progress;
- secrets remain server-side and diagnostics do not expose them.

A deterministic stream and deterministic embedding fixture provide repeatable
acceptance. A hosted optional run against a real model/provider measures
integration experience separately and cannot replace deterministic evidence.

## Cross-application acceptance kernel

Every arm retains machine-readable evidence for:

- deterministic setup, seed, and cleanup;
- at least two named authenticated actors plus an outsider;
- one actor-specific positive transition and one cross-user negative;
- authoritative data observed independently of the initiating UI;
- realtime transport attribution: push, poll, local optimistic state, or
  unsupported;
- disconnect, reconnect, and stale-data behavior;
- operation settlement, including retry or ambiguity where applicable;
- exact backend/project/deployment identity;
- expected check count, so a vacuous pass fails;
- command exit status and structured failure classification; and
- explicit skips and nonclaims.

A rendered update alone does not prove backend state, push delivery, auth, or
settlement. Polling does not count as native push. Client animation does not
count as authoritative streaming. Seeded state does not prove a mutation.

Any cross-user data disclosure, secret exposure, destructive cleanup against
an unrelated target, false capability claim, or late effect after a confirmed
cancellation is a Stop-class defect. Metric work pauses until the defect is
understood.

## Program stages

### Stage 0: Freeze

Before application implementation:

- freeze this Plan's accepted revision;
- materialize the neutral app prompts and UI shells;
- freeze acceptance scenario identifiers and expected-check counts;
- pin provider profiles, versions, plans, regions, and documentation;
- pin agent model, tool configuration, assistance policy, and machine image;
- preflight credentials without exposing their values;
- define source/generated/dependency inventory scripts;
- create the diary files; and
- record Snapback's starting commit and capability inventory.

Outcome-affecting changes after freeze require a dated amendment. Corrections
apply prospectively and never rewrite retained evidence.

### Stage 1: Calibration

Build Todo and Chat on all seven backends. Backend order is randomized once and
recorded before work begins. Finish all arms against one frozen Snapback commit;
do not improve Snapback between arms.

Report the three non-composite outcomes and a provisional composite. The
provisional ranking is diagnostic, not the final ranking.

### Stage 2: First Snapback remediation

Synthesize calibration findings into:

- defects;
- capability gaps;
- authoring/experience improvements;
- documentation or diagnostic failures;
- operational gaps; and
- benchmark-only issues that should not become product features.

Prioritize changes by user impact, recurrence across apps, competitive
leverage, and generality. A change is eligible only when it improves a
provider-independent product outcome and carries its own acceptance witness.

Land each accepted Snapback change with the relevant guide, LLP, issue, and
diary updates. Then rerun the frozen Todo and Chat acceptance suites. Preserve
the original time and friction evidence.

### Stage 3: Deep round

Build Linear, Partiful, and Research Room on all seven backends using frozen
specifications. Freeze one new Snapback commit before the round and do not
remediate Snapback between arms.

An arm may be stopped when its budget expires, but its incomplete state,
blocker, work performed, and untimed continuation remain evidence. A backend
must attempt all five apps to be eligible for the final total ordering.

### Stage 4: Second Snapback remediation

Repeat the synthesis process using all five apps. Changes must address
generalized outcomes, not fixture names or acceptance-test special cases.

### Stage 5: Final confirmation and ranking

From clean external projects:

- rebuild the final Snapback arms under the same assistance rules;
- rerun every provider's acceptance evidence;
- refresh any competitor arm whose provider version, recommended path, or
  earlier evidence changed materially;
- produce per-app rankings, category scores, the holistic composite,
  sensitivity analysis, and confidence labels; and
- publish the Snapback improvement backlog separately from the ranking.

## Time and assistance budgets

Each arm gets two separately reported windows:

1. a **timed diagnostic window** used for first-hour and completion metrics;
2. an optional **untimed completion extension** used to learn from deeper
   integration after the timed outcome is fixed.

Budgets:

| App class | Timed active-work ceiling | Tool-call ceiling |
| --- | ---: | ---: |
| Todo or Chat | 4 hours | 200 |
| Linear, Partiful, or Research Room | 8 hours | 400 |

Active time begins with the first provider-specific project command and
includes installation, schema work, backend code, client integration,
debugging, testing, and deployment. Pre-authorized account creation and
credential issuance are recorded separately; unplanned credential repair
counts as friction and pauses the clock only while waiting on a human or
provider outage.

The same agent model, reasoning setting, tool access, and neutral prompt apply
to every arm. Each arm begins in a fresh context with:

- the product specification and acceptance identifiers;
- the neutral UI shell;
- the provider's official documentation and official starter templates;
- credentials for the frozen fresh or namespace-isolated shared target mode;
- no implementation notes from another provider arm.

Snapback receives its shipped guide, not repository source knowledge, except
when official diagnostics direct the builder to inspect source. Source
inspection, undocumented examples, community answers, human help, and
cross-arm knowledge are allowed only when recorded as assistance events.

No human intervention is expected after credential preflight. Every
intervention records elapsed time, reason, information supplied, and whether
another backend received an equivalent opportunity.

## Measurement record

Each arm retains:

- time to first successful local read;
- time to first authoritative mutation;
- time to first verified realtime transition;
- time to acceptance completion;
- time to hosted URL;
- authored commands, failed commands, retries, and interventions;
- agent tool calls and token usage when available;
- authored, generated, test, configuration, policy, and dependency volume
  separately;
- setup and installed dependency size;
- cold and warm representative latency;
- memory, idle activity, and build/deploy duration where measurable;
- failures grouped as product, documentation, environment, credential,
  provider outage, harness, or builder error;
- complete glue and workaround inventory; and
- exact versions and target identities.

Elapsed metrics use a monotonic clock. Warmups, repetitions, statistics, and
performance workload shapes follow LLP 0035 and are frozen before measurement.
Qualitative observations are evidence too, but never masquerade as timings.

## Diary protocol

Create one numbered diary per application, using the next available diary
number and the filename `NNNN-<app>-backend-bakeoff.diary.md`. Each provider
arm appends one dated entry. Remediation and reruns append later entries to the
same app diary.

Diaries are immutable point-in-time records. Corrections append a dated
erratum; they do not rewrite the original experience.

Every provider entry uses this template:

```markdown
## YYYY-MM-DD — <backend>, <round>, <result>

### Environment
- versions, target, plan/region, commit, documentation snapshot
- timed window, assistance events, credentials/outages

### Milestones
- first read, mutation, realtime, local acceptance, hosted acceptance

### What felt good
- concrete moments and why they mattered

### What felt bad or frustrating
- concrete moments, errors, repetition, uncertainty, or surprise

### Modeling and correctness
- schema/query/transaction/conflict experience

### Realtime, offline, and auth
- observed semantics, attribution, gaps, and confidence

### Deployment and operations
- setup, deploy, logs, inspect, migrations, backup/restore, cleanup

### Documentation and diagnostics
- what was discoverable; what required source, guessing, or help

### Glue and workaround inventory
- files/lines/processes/services that the platform did not supply

### Outcome
- acceptance passes/failures/skips, evidence links, and Stop defects

### Would I choose it?
- for this app, yes/no/conditional, with confidence and the decisive reason

### Lessons for Snapback
- desired user outcome, classification, generality, and possible Snapback-native response
```

Record positive competitor experiences with the same specificity as negative
ones. Record apparent Snapback failures that turn out to be harness or learning
mistakes; they remain real discoverability evidence.

## Reported outcomes

### 1. Product completeness

Report required product facts as pass, fail, explicit GAP, expected refusal, or
unavailable remote dependency. A GAP is never a pass. A safe expected refusal
may pass a negative test.

### 2. Authoring cost

Report raw timings, commands, failures, interventions, source volume, glue, and
workarounds. Do not convert all authoring cost into a single number before
showing the raw record.

### 3. Correctness and evidence confidence

Score directness and reproducibility of:

- actor and authority attribution;
- transaction/conflict evidence;
- transport attribution;
- offline and reconnect evidence;
- settlement evidence;
- target identity;
- cleanup isolation; and
- artifact reproducibility.

Each dimension is 0 (missing or contradicted), 1 (indirect), or 2 (direct and
reproducible). Report the 16-point total, but retain dimension-level reasons.

### 4. Holistic composite

The holistic composite uses ten weighted categories:

| Category | Weight |
| --- | ---: |
| Authoring speed and conceptual simplicity | 15 |
| Data modeling and query power | 10 |
| Correctness and consistency | 10 |
| Realtime and offline behavior | 12 |
| Authentication and authorization | 8 |
| Platform completeness and integrations | 10 |
| Deployment and operations | 12 |
| Testing, diagnostics, documentation, and agent usability | 8 |
| Performance, scale, and cost | 7 |
| Maturity, ecosystem, portability, and control | 8 |
| **Total** | **100** |

For each app and category, assign:

- **0:** unsupported or no credible completion path;
- **1:** possible only through unsafe behavior or a largely custom external
  system;
- **2:** works with major glue, caveats, or recurring uncertainty;
- **3:** ordinary competent experience;
- **4:** notably strong or low-friction;
- **5:** exceptional and preference-shaping.

The weighted backend score is the equal-weight mean of its five app ratings.
Every rating cites diary and machine evidence. An unattempted app makes a
backend ineligible for total ordering; it is not silently scored zero.

Stop-class security or correctness defects are displayed beside the score and
make the backend ineligible as a go-to choice for the affected application
until the tested version fixes the defect. A composite cannot average away a
data disclosure or destructive cleanup bug.

Scores within three points are a practical tie unless the go-to narrative
identifies a decisive non-score reason. The final report varies each category
weight one at a time by plus or minus 25 percent, renormalizes to 100, and
reports every rank change. A ranking that changes frequently is labeled
weight-sensitive.

The primary ranking is "what I would choose today." A separate architectural
potential assessment may discuss trajectory, but contributes zero points.

## Snapback improvement synthesis

Every Snapback lesson receives:

- a short outcome-oriented title;
- source app(s) and backend comparison;
- evidence and frequency;
- classification: defect, capability, experience, docs/diagnostics,
  operations, or benchmark-only;
- severity and reach;
- the competitor outcome worth matching;
- the Snapback property that must be preserved;
- a proposed Snapback-native outcome, without presuming implementation;
- acceptance evidence that would prove improvement; and
- destination: immediate fix, filesystem issue, existing LLP, new LLP, or
  deliberate non-goal.

The synthesis reports:

1. immediate defects and papercuts;
2. repeated experience improvements;
3. missing table-stakes capabilities;
4. differentiators worth protecting and amplifying;
5. architectural rethink triggers;
6. deliberate non-goals; and
7. the next remediation tranche, ordered by expected user value.

Do not create thirty-five provider-shaped abstractions inside Snapback. Match
the valuable end result through Snapback's coherent authority, settlement,
local-first, and target model.

## Bias controls

- Freeze each round before seeing its comparative outcome.
- Do not modify Snapback between arms in one round.
- Randomize backend execution order once per app.
- Use fresh targets where available; otherwise use unique namespaces and
  baseline-preserving cleanup inside an explicitly disclosed shared target.
- Preserve failed attempts and assistance events.
- Use official, idiomatic provider paths.
- Attribute builder errors separately without deleting their time cost.
- Do not penalize a managed provider merely for using managed infrastructure.
- Do not reward Snapback for repository-local source access unavailable to an
  external user.
- Do not reward a provider for a client-only illusion that lacks authoritative
  evidence.
- Refresh competitor capabilities from primary sources at each freeze.
- Have a reviewer who did not build the arm audit final subjective ratings and
  retain disagreements rather than forcing consensus.

## Deliverables

- five numbered application diaries;
- frozen prompts, UI shells, and behavioral acceptance manifests;
- thirty-five provider arms or an explicit ineligibility record;
- per-arm acceptance reports and cleanup receipts;
- a versioned provider capability inventory;
- calibration and deep-round reports;
- a Snapback remediation ledger with before/after evidence;
- per-app rankings;
- the final holistic composite and sensitivity analysis;
- a narrative go-to recommendation;
- a separate architectural-potential assessment; and
- a prioritized Snapback improvement synthesis.

## Stop, continue, and eliminate

- **Stop an arm:** a Stop-class defect appears. Diagnose it before further
  metric work.
- **Timebox an arm:** its diagnostic budget expires. Freeze the timed result,
  then optionally continue untimed for learning.
- **Eliminate from deep round:** only when the user explicitly accepts that the
  backend is outside the intended product class. Resource pressure alone does
  not turn an unattempted backend into a ranked loser.
- **Continue the program:** evidence is valid and the next app explores a
  materially different backend boundary.
- **Rework the protocol:** two or more arms are distorted by a shared harness,
  lowest-common-denominator interface, unavailable credential class, or
  ambiguous acceptance fact.

## Resolved setup decisions

These defaults were frozen before provider-specific implementation:

1. **Independent rating audit.** Charlie adjudicates the final narrative. At
   least one reviewer from a model family that did not build the arms receives
   the frozen evidence and scores before seeing the builder's scores. The
   reviewer's exact identity, model/version, context, and disagreements are
   retained with the report. Reviewer unavailability lowers confidence; it
   does not permit a fabricated independent review.
2. **Managed plans and regions.** Each hosted arm uses the lowest-cost plan
   that supports every product fact the provider actually claims. Free or
   preview plans are acceptable when they are production-capable for the
   tested facts. Select the nearest available US-West region; when the provider
   does not expose region choice, record provider-selected placement. Exact
   plan, region, limits, and list price are frozen per round.
3. **Neutral identities.** Every arm has `alice`, `bob`, and `mallory` as human
   personas, implemented through the provider's native first-party auth path.
   Alice and Bob are authorized members; Mallory is the outsider. Use native
   email/password, magic-code, anonymous-development, or emulator identities
   as the provider recommends, and record the difference. Do not add a shared
   external identity provider merely to normalize the comparison.
4. **Target lifecycle.** Prefer a fresh isolated local or hosted target per arm.
   When credentials provide only a shared target, bind a unique arm namespace,
   retain a baseline before writing, and retire only the namespace with proof
   that unrelated baseline state is unchanged. Never delete a shared target,
   reuse a namespace, reuse a target between providers, or let a broad cleanup
   command infer its target. Local-only execution is permitted when hosted
   credentials remain unavailable, with the missing hosted evidence and
   confidence consequences reported explicitly.
5. **Performance and cost scope.** Measure a small, frozen product workload,
   not production scale: two warmups followed by seven recorded samples for
   representative read, write, realtime-delivery, reconnect, and deploy/build
   paths supported by the app. Freeze dataset sizes and concurrency in the
   app acceptance manifest. Report raw samples plus median and p95-like nearest
   rank, machine load/context, actual isolated-arm usage where available, and
   the provider's list-price estimate over the same window. Extrapolation is
   labeled and never used as measured scale evidence.

## Status

Accepted for execution on 2026-07-28 after the author directed the bakeoff to
start and the setup decisions above were resolved. Stage 0 remains a hard gate:
no timed provider arm starts until the exact provider inventory, neutral
prompts and UI shells, acceptance manifests, budgets, assistance policy,
environment record, credential readiness, and artifact digests pass the
machine-readable freeze verifier.
