# LLP 0183: Zerobugs-quality relational application surface

**Type:** RFC
**Status:** Draft
**Systems:** Product, Application data API, Relational queries, Client SDK, React, Local sync, Offline sync, Optimistic updates, Auth, HTTP surface, Search, Notifications, Assets, Storage, Deployment, Performance, Developer experience, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-05
**Revised:** 2026-08-07 (Stage 0.5 completion + author rulings, Claude Fable
5: records the control's receipted completion, the OQ13/D3/§13-ratification/
review-loop rulings, and the ratification artifact pointer) · 2026-08-05
(Stage 0 execution, Codex gpt-5.6-sol / Claude Fable
5: narrows the D5 `Date.now()` replacement claim to the issue create/update,
emoji add, and comment add server overrides after pin re-verification) ·
2026-08-05 (authorial review, Codex gpt-5.6-sol: narrows this to an umbrella RFC; replaces unsupported fixed performance margins with a pre-implementation freeze protocol; makes projected-fact reuse a staged candidate rather than an admitted capability; defines production edges as a supported composition profile; corrects the client-value comparison; and lets the current-surface control report rather than predetermine outcomes) · 2026-08-05 (design-partner revision, Claude Fable 5: adds the current-surface control arm, staged projected-fact investigation, server-backed windowing, authoring-delta evidence, and refusal-union ownership) · 2026-08-05 (initial draft)
**Related:** LLP 0000, LLP 0004, LLP 0005, LLP 0008, LLP 0012, LLP 0016, LLP 0031, LLP 0043, LLP 0045, LLP 0046, LLP 0053, LLP 0057, LLP 0060, LLP 0065, LLP 0070, LLP 0072, LLP 0073, LLP 0080, LLP 0100, LLP 0107, LLP 0108, LLP 0110, LLP 0114, LLP 0128, LLP 0129, LLP 0133, LLP 0134, LLP 0135, LLP 0138, LLP 0144, LLP 0153, LLP 0155, LLP 0157, LLP 0166, LLP 0170, LLP 0172, LLP 0173, LLP 0182

## Summary

Snapback should use the source-pinned Zerobugs application documented in [LLP
0182](./0182-zerobugs-snapback-parity.research.md) as a whole-product quality
bar. The goal is a Snapback-backed Zerobugs that is at least as good as the
pinned Zero-backed application in required behavior, correctness, security,
responsiveness, authoring, and production operation.

The goal is not architectural imitation. Snapback should preserve its accepted
authority, revocation, bounded-work, target-portability, durable-intent, and
small-local-operation decisions. The proposed program has eight workstreams:

1. freeze a source-faithful comparator, acceptance manifest, and current-
   Snapback control arm;
2. add a bounded relational graph profile for the real list and detail queries;
3. investigate authority-scoped projected facts and local graph evaluation in
   staged risk classes;
4. ship a headless windowed-query controller, first in server-backed mode;
5. lower the actual mutation corpus to current generated IR, then widen only
   where measured gaps pass LLP 0129's admission gates;
6. add portable generated derived fields and maintained search documents where
   the query graph alone cannot express the workload safely;
7. qualify a supported production composition for identity, application HTTP,
   durable notifications, and assets; and
8. qualify the complete application on one production target and large-data
   profile.

This RFC is the program charter and acceptance contract. It does not itself
admit a query language, browser store, mutation verb, route runtime, effect
system, or hosted target. Those mechanisms remain independently reviewable and
must be specified and accepted by their existing owners.

Five structural differences remain intentional. Snapback will not promise
unrestricted whole-row local custody, parity with arbitrary present or future
ZQL/PostgreSQL expressions, arbitrary same-by-convention browser/server
TypeScript, Zero's exact speculative-value continuity on every mutation path,
or drop-in PostgreSQL logical-replication topology. The acceptance program
tests whether bounded Snapback mechanisms provide equal product quality despite
those differences.

## Decision requested

Accept Zerobugs as a named product benchmark and authorize the staged program
and evidence requirements in this RFC.

Acceptance would mean:

- LLP 0182 is the research record for the pinned workload and initial gap
  classification.
- D1 and ZB0–ZB7 define the benchmark and what evidence a parity claim needs.
- D2–D8 are workstream briefs. Each load-bearing mechanism needs an owner Spec
  or an explicit amendment to an existing owner before capability publication.
- Projected facts are a candidate direction, not an admitted capability.
  Each authority/projection risk class in D3 is admitted separately.
- LLP 0129 remains the sole admission authority for browser-executable
  mutation semantics.
- A supported production composition may include a versioned companion
  gateway or worker. Product parity does not require every service Zero obtains
  from its application server to become a primitive of the Snapback runtime.
- The application gets a diary under LLP 0016, a pre-land corpus audit, and
  immutable provider-attempt receipts under LLP 0138.
- No whole-product claim may be based on a reduced schema, headless-only run,
  memory-only client, local-only server, unpinned Zero version, or undeclared
  bespoke sidecar.

This RFC does not accept itself, choose syntax or storage formats, select a
hosted database, promote a current GAP, or authorize application-authored code
to execute in a browser or trusted runtime.

## Scope and delegated authority

LLP 0005 recommends splitting a large RFC when its subtopics can be reviewed
independently. This document therefore decides the benchmark, sequencing, and
claim rules only. It deliberately leaves wire formats, storage layouts,
evaluators, APIs, and security proofs to owner documents.

| Workstream | Existing authority | Required owner result |
| --- | --- | --- |
| D1 comparator and control | LLP 0016, LLP 0138 | Versioned manifest, diary, immutable evidence |
| D2 relational graph | LLP 0080, LLP 0100, LLP 0110, LLP 0135, LLP 0155 | Successor query Spec and conformance corpus |
| D3 projected facts | LLP 0008 DK-9, LLP 0053, LLP 0155 OQ2, LLP 0157, LLP 0166 | Staged store/evaluator Specs or explicit refusal |
| D4 window controller | LLP 0012, LLP 0107, LLP 0114 | Headless lifecycle Spec and React projection |
| D5 generated writes | LLP 0129, LLP 0133 | Corpus evidence and per-verb admission in LLP 0129 |
| D6 derived/search data | LLP 0065, LLP 0073, LLP 0080 | Portable expression and maintained-data Specs |
| D7 production composition | LLP 0031, LLP 0045, LLP 0057, LLP 0060, LLP 0070, LLP 0108, LLP 0144, LLP 0153, LLP 0172 | Versioned, supported composition profile and owner amendments |
| D8 hosted qualification | LLP 0046, LLP 0072, LLP 0128 | Target capability facts and recovery evidence |

When this RFC conflicts with an Accepted owner, the owner governs until it is
explicitly amended. In particular, `result-transform.v1`, the current fragment
store, current mutation IR, and current route/effect capabilities remain the
implementation truth while successor work is in Draft or Review.

## Quality target

### Required application surface

The benchmark is the pinned application, not a visually similar CRUD subset.
The manifest must cover:

- projects and role/visibility-aware issues;
- open/closed, creator, assignee, all-selected-label, and text filters;
- selectable stable ordering and bidirectional keyset navigation;
- issue-list labels and per-user view state;
- issue detail with project, creator, assignee, labels, view state,
  notification state, emoji, and comments;
- virtualized long issue lists and comment threads;
- permalink navigation to an item outside the current window;
- issue, comment, label, emoji, view-state, preference, and notification
  mutations;
- optimistic behavior wherever a local program is admitted, with explicit
  pending, rejected, settled, and observer-converged states;
- useful retained reads through disconnection and durable queued intent for
  admitted operations;
- external identity, authorization changes, logout, and user switching;
- image upload and delivery under the application's policy;
- email/webhook-class notification delivery with durable intent and receipts;
- machine-readable issue and unsubscribe routes;
- a supported TLS deployment with secrets, backup, restore, inspection, and
  release identity; and
- a deterministic large-data profile derived from the pinned generator.

### Quality is a vector, not a score

The comparison reports these dimensions independently:

1. feature correctness;
2. authorization and negative delivery;
3. local-data behavior and completeness;
4. optimistic authoring and settlement;
5. viewport, navigation, and interaction latency;
6. client facts, rows, bytes, and hydration work;
7. server throughput and live fanout;
8. browser bundle and storage cost;
9. implementation and source burden;
10. deployment and recovery burden; and
11. diagnostics and inspection.

Correctness, security, and recovery are hard gates. A latency, custody, or
authoring win cannot compensate for a wrong result, leak, lost accepted write,
or unverifiable restore. No composite score is computed.

The final report may say **as good as the pinned Zero application** only when:

- every required feature, correctness, security, and recovery gate passes;
- every critical interaction and authority path passes its predeclared
  noninferiority rule;
- required behavior uses supported, disclosed components;
- local absence and completeness are never overstated; and
- structural non-parities are visible in capability and refusal facts rather
  than concealed by a reduced demo.

It may say **better** only if, before Stage 1, the manifest names at least one
primary advantage and its success threshold. Candidate advantages are durable
disconnected intent, lower protected-client custody, or lower operational
burden. The winner cannot be selected after results are known, and all hard and
noninferiority gates must still pass. Without that evidence, the strongest
permitted claim is parity.

### Freeze performance margins from evidence

LLP 0182 found no existing comparative measurement from which defensible
numeric margins can be derived. This RFC therefore does not invent fixed
percentages or millisecond allowances.

Before Stage 1 implementation begins, the acceptance manifest must freeze:

- critical interactions and their start/end events;
- local, cold-online, hosted, and authority/convergence paths measured
  separately;
- browser, machine, network, fixture, warm-up, and sampling profiles;
- raw-distribution reporting, including median, tail, long-task, and error
  behavior where applicable;
- an observed run-to-run variability envelope from repeated Zero-arm and
  current-control trials;
- a path-specific noninferiority margin justified by both measurement noise
  and the largest user-visible regression the authors are willing to accept;
  and
- the review and amendment rule for the frozen manifest.

The current-Snapback control may reveal feasibility or instrumentation gaps,
but its slowness cannot by itself justify loosening a Zero-relative margin.
After the first Stage 1 attempt, a margin may change only by creating a new
versioned benchmark; the original result remains visible.

## Design principles

1. **Match the application, not Zero's machinery.** PostgreSQL, logical
   replication, `zero-cache`, whole-row custody, and ZQL syntax are not goals.
2. **One declared screen graph.** Admission, server execution, live matching,
   hydration, local evaluation, result typing, React, and inspection consume
   one content-addressed graph identity.
3. **Reuse facts only with proof.** Projection, authority, policy version,
   membership, and completeness are part of local identity. Compatible data
   is not automatically combinable data.
4. **The viewport is query state.** Cursors, demand, retention, permalink
   lookup, completeness, and scroll restoration belong to a headless lifecycle.
5. **One deterministic database program where admitted.** Generated IR may run
   speculatively in the browser and authoritatively on the server; unsupported
   operations remain honestly server-backed.
6. **Prediction never becomes authority.** The server still decides
   authorization, trusted time, uniqueness, conflict resolution, effects,
   ordering, and commit.
7. **Bounds and completeness are product features.** A bound hit yields
   `unknown`, a proved prefix/window, or refusal—never a plausible truncation.
8. **Production edges count.** Identity, routes, notifications, assets,
   backup, restore, and deploy are part of application quality, whether native
   or supplied by a supported companion.

## D1 — comparator, manifest, and current-surface control

Freeze a versioned acceptance manifest from the source pin in LLP 0182 before
new capability work. It records:

- repository, commit, package versions, and relevant source digests;
- schema, relationships, queries, arguments, projections, mutations, and
  visible optimistic facts;
- normal, large, and hot deterministic fixtures;
- actors, policies, revocation transitions, and negative-delivery expectations;
- browser, machine, network, target, and performance methodology;
- custody, source/touch-count, assistance, and workaround accounting;
- identity, route, asset, notification, backup, restore, and cleanup fixtures;
- capability/refusal facts consumed by the app; and
- one immutable evidence artifact for each provider attempt.

Use the actual UI or a source-faithful port for both provider arms. A smaller
conformance harness is useful but cannot close the whole-application gate. The
moving production site is context, not a mutable baseline; a new Zero version
creates a new manifest version.

After the freeze and before D2–D8 implementation, build the complete app on the
current shipped Snapback surface. This control may use declared denormalized
read models, query groups, application-owned windowing, handwritten optimistic
reducers, and a supported gateway/worker where today's capabilities require
them. Record each workaround and unsupported path rather than hiding it.

The control runs every applicable ZB gate and reports the exact PASS, GAP, or
not-applicable result. Its purpose is not to predetermine failure. It validates
the anti-reduction harness, lowers the real mutation corpus to current IR,
measures current authoring burden, informs instrumentation, and yields a UI
that later stages can reuse. Existing LLP 0138 evidence may replace a control
row only through an explicit dated equivalence note.

## D2 — bounded relational graph profile

### Workstream outcome

The issue list and detail screens compile to generated, bounded relational
graphs. Application code does not collect broad source sets, join them in JS,
apply authorization after collection, sort an implicit prefix, or maintain a
parallel handwritten result type.

LLP 0209 owns this brief. Its Spec defines a finite acyclic profile with:

- one bounded root window with portable filters, stable multi-field order,
  explicit tie-breaker, keyset cursor, and `take`;
- equality to-one and bounded, parent-indexed to-many relations;
- `exists`/semi-join nodes, including bounded repeated existence for
  all-selected-label filtering and declared through tables;
- relations whose predicate binds the server-derived principal to private
  state such as `viewState` or notification state;
- admitted search membership from D6; and
- a closed nested projection.

Arbitrary callbacks, recursion, data-dependent graph construction, unbounded
child expansion, and client-supplied query ASTs remain outside this brief.

Every admitted graph declares root, examined-entry, relationship, fanout,
argument, byte, summed-window, and maintained-write bounds. The owning Spec
sizes them from the normal and large fixtures; this RFC does not blindly reuse
current ceilings or authorize unbounded scans.

The result vocabulary must distinguish:

- `unknown`, when useful facts exist without a sufficient proof;
- `complete`, for the entire named graph at one authority/plan/args/version;
- `prefix`, only when ordering and continuation prove a stable prefix;
- `window`, for a complete named interval without a whole-query claim; and
- `refused`, with a stable reason.

Authorization and information flow apply at every node. A visible parent does
not make a child visible. Hidden rows may not affect an observable result,
order, length, existence bit, completeness claim, search membership, or
caller-visible hydration behavior unless policy explicitly admits that
channel. Opaque handler assertions do not constitute mechanically proved
protection; LLP 0170 continues to govern.

The first capability can publish only when the pinned project restriction,
role visibility, open/creator/assignee/all-label/search filters, selectable
orders, two-way windows, private overlays, list relations, and detail relations
pass one conformance corpus on every claimed target. (Current status: the
LLP 0209 §9 v0.11 publication-readiness matrix — zero publishable targets as
of 2026-08-25; search remains D6-gated; the test-support declaration is not a
claimed target.)

## D3 — staged projected facts and local graph evaluation

### Candidate direction, not present admission

Investigate a successor to LLP 0166's one-result transform: an authority-
scoped, projection-aware local fact store plus a restricted evaluator for
admitted D2 graphs. This is the candidate answer to LLP 0155 OQ2. Acceptance of
this umbrella RFC does not answer OQ2 or publish cross-query reuse.

The logical design must account for projected entity facts, relationship
edges, named range/absence proofs, query memberships, plan/args/window
identity, provisional facts, durable intent, settlement, retention,
quarantine, and predecessor retirement. The owner Specs decide physical
layout, wire protocol, and evaluator API.

Cross-query reuse must advance by risk class:

1. **Authority-independent public, exact projection.** Reuse identical public
   base facts across compatible registrations. This is the first candidate
   because no principal-specific overlay or field union is involved.
2. **Authority-independent public, compatible projection.** Prove whether a
   wider public projection can safely satisfy a narrower request without
   inventing completeness or version coherence.
3. **Per-principal private, exact projection.** Reuse private overlays only
   inside an identity/policy partition with logout, user-switch, revocation,
   and predecessor retirement evidence.
4. **Protected or projection-subsuming reuse.** Consider role/visibility-
   protected base facts and wider private projections only after adversarial
   field, existence, membership, absence, timing, and version-skew tests.

Each class requires its own owner decision and capability fact. Failure at a
later class does not invalidate an earlier safe class. No class may union facts
across principals or policy partitions.

The pinned list is a useful staging workload because its public project facts
and per-user `viewState`/preference/notification overlays can remain separate.
Passing class 1 alone does not make that combined screen locally complete.
Protected role visibility and wider projection reuse carry materially greater
risk and cannot borrow the public result.

For any admitted class, local and server evaluators consume the same graph IR
and must agree on canonical values, ordering, nulls, cursors, relations,
search membership, bounds, and completeness. Missing facts yield `unknown` and
hydrate; they never become negative facts. Every retained byte needs an active
or retained membership reason and must retire or quarantine on release,
logout, principal change, policy invalidation, artifact change, or lease expiry
under LLP 0053.

If the evidence rejects safe projected reuse, Snapback remains fragment-scoped
and the final report records the corresponding local-query gap. This RFC does
not require the store to be admitted merely to preserve the program plan.

## D4 — headless windowed-query controller

Define one headless lifecycle for virtualized lists and threads, with a
first-party React projection. It owns active ranges, forward/backward demand,
prefetch, cancellation, deduplication, eviction, query replacement, permalink
lookup, scroll anchors, restart restoration, and completeness.

Ship and validate a server-backed mode before D3. It treats returned windows
as opaque query results and therefore improves the application without
presupposing projected facts. A later local mode may read admitted D3 facts,
but must expose the same state machine and distinguish loading, unknown,
proved-missing, stale, and refused.

Window identity includes query/plan, args, order, cursor boundaries, authority,
policy, and version. Changing identity cannot flash predecessor rows as the
new result. Permalink absence requires authoritative proof, not failure to find
an item in the current viewport.

## D5 — generated mutation programs

First lower every pinned mutation to current generated IR and classify it as:

- already expressible and locally executable;
- expressible only with an explicit application value or current Lane Q;
- correctly server-only with honest pending behavior; or
- inexpressible without a new deterministic verb.

Only the last class proposes IR widening, and LLP 0129 controls its admission.
Likely workload classes include guarded patch/delete, bounded dependent delete,
join-row upsert/removal, and bounded branch or multi-table effects, but this RFC
does not pre-admit any of them. Every addition needs measured frequency,
boundedness, dual-evaluator conformance, rejection/rebase behavior, and a
strict improvement over application-authored duplicate reducers.

The authored program is intent, not final authority. Local execution predicts;
the trusted server rechecks authentication, authorization, invariants,
uniqueness, trusted time, conflicts, and external effects. Unsupported
capabilities remain server-only rather than invoking arbitrary application JS
in the browser.

The pinned Zero app chooses many row ids on the client and its server mutators
preserve those ids, while server overrides replace client timestamps with
trusted `Date.now()` values on the issue create/update, emoji add, and comment
add paths (view-state and notification timestamps remain client-supplied). Thus even Zero's immediate result is speculative; it does
not make every predicted value authoritative. Snapback's current Lane L instead
re-derives runtime ids/time and maps provisional ids by default, while Lane Q
and explicit application arguments have different continuity. Exact
provisional-value continuity is therefore not promised by this umbrella RFC.
An owner may admit a server-validated client-id policy for specific tables, or
the UI may preserve identity through mapping; the benchmark judges visible
quality and correct settlement, not byte identity with Zero's speculation.

Application refusals remain closed tagged data under LLP 0108 and LLP 0144.
External notifications enqueue only after authoritative commit and must never
fire from speculative execution.

## D6 — portable derived fields and search documents

The query graph should not become a general expression language. Where the
pinned workload needs semantics outside the portable graph, owner Specs may
admit generated, schema-visible derived fields or maintained search documents.

The initial investigation should cover only measured needs, including bounded
typed JSON-path extraction and normalized search over issue title,
description, and comments. Each artifact declares source dependencies,
canonicalization, null/error behavior, target lowering, update transaction,
write amplification, rebuild procedure, and inspection identity.

Search equivalence must be explicit. If Snapback intentionally provides richer
token or ranking semantics than the pinned app's substring behavior, the
manifest retains a shared conformance subset and reports the richer behavior as
an intentional improvement, not silent query drift. Unbounded aggregate
recomputation and raw target SQL remain refused.

## D7 — supported production composition

The Zerobugs product includes services that are not supplied by Zero's sync
engine itself: external identity exchange, application HTTP routes, asset
handling, and notification delivery. Fair parity therefore requires a
supported composition, not necessarily native Snapback primitives for all four.

A qualifying component may be:

- a bounded route/effect facility owned by Snapback; or
- a first-party or formally packaged companion gateway/worker with a versioned
  contract.

Either form must be declared in the capability manifest and share a coherent
application/deployment identity, authentication and authorization model,
secret lifecycle, release procedure, observability, receipts, recovery story,
and cleanup ownership. It may not forward arbitrary admin authority or treat a
browser assertion as trusted identity. Routes need explicit method/path/input/
output/auth bounds; effects need durable idempotency or explicit ambiguity.

The first profile must cover the pinned external sign-in/callback path,
machine-readable issue route, unsubscribe route, image upload/delivery policy,
and email plus webhook/Discord-class notification witness. Streaming and a
general-purpose web framework are not required unless the workload proves they
are necessary.

An undeclared one-off sidecar cannot close ZB0 or ZB7. Conversely, using a
declared supported companion is not a failure of parity merely because it runs
outside the core Snapback process.

## D8 — one hosted qualification

Qualify one production target against the complete ordinary, large, and hot
profiles before expanding the matrix. Target selection follows measured
readiness; this RFC does not mandate PostgreSQL or authorize a storage choice
before the fixture supplies evidence.

The target must publish its exact query, write, live, search, route/effect,
asset, backup, restore, release, and scale capabilities. The inspector must
show plan identity, bounds, examined work, query custody, hydration, retained
facts and reasons, pending/settled operations, effect receipts, and target
release identity. A clean install, public TLS run, backup, verified paused
restore, activation, reconnect/resnapshot, and cleanup are part of
qualification.

## Structural non-parities

These are deliberate boundaries, not hidden backlog promises.

| Zero/Zerobugs property not structurally matched | Snapback decision retained | Required substitute quality |
| --- | --- | --- |
| Broad matched rows can be reused by arbitrary compatible local queries | Query/projection-scoped custody; only independently admitted authority-partitioned fact reuse | Pinned queries reuse only proved-compatible facts; unauthorized fields, membership, existence, and absence do not appear |
| Present and future ZQL/PostgreSQL expression breadth | Closed, bounded, versioned, target-portable graph and derived-expression profiles | Every pinned query is expressible or intentionally improved; unsupported forms refuse with actionable alternatives |
| Arbitrary same-by-convention client/server TypeScript mutators | Generated deterministic local IR plus independent authoritative execution; other operations remain server-only | Common admitted mutations are authored once; unsupported ones have honest pending and settlement behavior |
| Zerobugs client-chosen row-id continuity on its shared mutation path | Lane L re-derives runtime values and maps provisional identity by default; other lanes/explicit arguments remain separately governed | Immediate UI identity remains stable enough for the benchmark and settlement is explicit; exact speculative values are not promised |
| App-owned PostgreSQL plus logical replication and `zero-cache` topology | Snapback-owned portable schema/function contract and qualified target adapters, with a small local-server path | One supported hosted target runs the full workload without application-code changes; arbitrary existing PostgreSQL adoption is not claimed |

Neither product grants final disconnected authority over shared data. For
Snapback, durable offline intent remains speculative until the server accepts,
orders, and commits it.

## Acceptance program

### ZB0 — source fidelity and anti-reduction

- Pin source commit, versions, schema, relationships, queries, mutations,
  services, fixtures, actors, and relevant source digests.
- Exercise all required screens and application edges through a source-faithful
  UI.
- Fail the harness when a required feature is skipped, hardcoded, prejoined in
  a fixture, or supplied by an undeclared component.
- Retain immutable first attempts and append remediation attempts.

### ZB1 — relational and window correctness

- Match expected rows for project, visibility, open, creator, assignee,
  all-label, search, sort, and combined filters.
- Traverse forward and backward without duplicate or skipped unchanged rows.
- Match list/detail relations at the declared snapshot/window semantics.
- Replace graph identity without leaking predecessor rows or memberships.
- Load around a permalink, preserve scroll state, and report missing only with
  authoritative proof.
- Never present an implicit limit or incomplete relation as complete.
- Use no application-side join/sort/filter over an incomplete broad source set.

### ZB2 — retained and local data

- For each admitted D3 class, locally satisfiable transitions run without
  network after declared hydration.
- Missing facts return `unknown` and trigger hydration; missing never implies
  absent.
- Browser restart renders retained data with exact freshness/completeness
  labels.
- Two tabs share storage safely and hand off writer ownership.
- Release, logout, user switch, artifact/policy change, revocation, and lease
  expiry retire or quarantine every affected fact.
- Inspection accounts for every retained fact, membership reason, and byte.
- Any D3 class not admitted remains an explicit GAP; the app does not simulate
  it with undisclosed whole-table custody.

### ZB3 — optimistic programs and durable intent

- Each admitted operation paints from generated IR without an app-authored
  duplicate reducer.
- Server rejection removes only its own effect and returns a declared safe
  application refusal.
- Concurrent authority rebases remaining operations and converges an
  independent observer.
- Termination before send preserves admitted durable intent and reconstructs
  its speculative presentation after restart.
- Revocation crossing a queued write rejects safely without leaking or
  committing unauthorized state.
- Effects occur only after authoritative commit and are idempotent or
  explicitly ambiguous.
- Server-only operations remain usable with honest pending behavior and do not
  count as one-authored local programs.

### ZB4 — authorization and information flow

- Exercise anonymous, ordinary, creator, assignee, admin, removed-member, and
  attacker actors against every protected graph and service class.
- Hidden rows/fields do not affect results, order, count-like UI, existence,
  completeness, search membership, retained facts, or caller-visible hydration
  except through explicitly accepted channels.
- Authenticated-but-unscoped handlers do not count as protected solely because
  they require a user; LLP 0170's executable-policy rule applies.
- Logout, user switch, role/member change, and out-of-band policy change meet
  LLP 0053 negative-delivery obligations.
- Route, effect, and asset components cannot bypass app authorization or expose
  admin/secrets surfaces.

### ZB5 — performance, scale, and custody

Run ordinary, large, and hot fixtures under the frozen local and hosted
profiles. Record at least:

- cold and retained route readiness;
- warm filter, sort, navigation, detail, and permalink latency;
- mutation paint, authoritative result, and observer convergence separately;
- virtual-window long tasks and memory;
- server examined work, query/write time, and live fanout;
- client facts, rows, bytes, hydration, and query-churn residue;
- restart, migration, backup, and restore time;
- effect queue depth/latency and asset latency; and
- CPU, memory, storage, bundle, and steady-state cost.

Report raw distributions and the frozen rule, not only PASS/FAIL. Lower client
custody counts as a win only if feature, latency, offline, and security gates
also pass.

### ZB6 — authoring and diagnostics

Fresh builders use only the guide and generated diagnostics for the final
Snapback arm. Record chronology, source/touch counts, assistance, rejected
paths, workarounds, and guide gaps. Compare it with both the pinned Zero arm
and the D1 current-Snapback control.

Required outcomes are:

- one declared graph per screen rather than JS collection joins;
- one authored program for each admitted optimistic operation;
- generated result/mutation types rather than parallel handwritten schemas;
- stable diagnostics for unsupported graph, IR, derived, carrier, and target
  classes;
- a measured delta for every workaround class found in the control, with
  removal or a dated explicit reason for retention;
- inspection of incomplete, retained, hydrated, refused, pending, rebased,
  settled, and retired states; and
- a filed `guide-gap` issue for required knowledge absent from the guide.

Line count alone is not an authoring-quality result. The report separates
application intent, generated output, adapter/configuration, test, and
workaround burden.

### ZB7 — production and recovery

- Deploy a clean immutable release through the supported target/control path.
- Complete external sign-in and protected query/mutation connections over
  public TLS.
- Upload and retrieve an asset under the intended policy.
- Deliver email and webhook/Discord-class notifications with receipts.
- Serve the machine-readable issue and unsubscribe routes safely.
- Create and read-back verify a backup.
- Restore into a paused target, verify, activate, and observe clients
  reconnect/resnapshot without accepting stale authority.
- Roll forward a compatible schema/function change without unreviewed identity
  widening.
- Remove every process, target, credential, database, queue, asset, and secret
  owned by the test.

## Sequencing

### Stage 0 — freeze and reconcile

1. Accept or revise LLP 0182's research claims.
2. Freeze the D1 manifest, performance method/margins, and any primary
   improvement claim.
3. Inventory exact graph, fact, mutation, route, auth, effect, asset, and target
   demands.
4. Record owner, document, dependency, and timebox for each workstream.
5. Create the diary and run the required corpus audit.

No new capability work starts until the workload and claim rules are frozen.

### Stage 0.5 — current-surface control

Build the complete source-faithful app using only shipped Snapback capabilities
and declared supported composition. Run every applicable ZB gate; retain exact
PASS/GAP results, the lowered mutation corpus, workaround inventory,
instrumentation receipts, and authoring baseline. Reuse the UI thereafter.

### Stage 1 — complete online application

Specify and implement D2, D4's server-backed mode, and the D6 subset the
workload proves necessary. Build the full online application on the local
target. Correct server mutations may provide non-optimistic fallbacks.

Exit when ZB0, ZB1, online ZB4, and applicable ZB5/ZB6 facts pass. A failed
owner admission produces an explicit program GAP rather than a substitute
hidden in application code.

### Stage 2 — local-data and write quality

Advance D3 one authority/projection class at a time. Run the pinned mutation
corpus through LLP 0129 and add only independently admitted verbs. Integrate
admitted local facts and programs with D4.

Exit when ZB2, ZB3, full ZB4, and local ZB5/ZB6 facts pass for every class
required by the whole-app claim in a real browser. A fake IndexedDB or
Node-only harness cannot close the stage.

### Stage 3 — production composition

Qualify D7 and one D8 target. Run production identity, routes, effects, assets,
deploy, backup, restore, release inspection, and cleanup.

Exit when ZB7 passes from a clean public-artifact installation. A formally
supported companion may close the stage; an undeclared bespoke service may
not.

### Stage 4 — comparator and promotion

Run both pinned provider arms under ordinary, large, and hot profiles. Present
each vector dimension separately, retain first attempts and remediations, and
publish only capabilities whose exact target/carrier/authority evidence passes.
Use only the claim language permitted by §Quality target.

## Capability publication and compatibility

Do not publish one `zerobugsParity` boolean. Publish the exact facts that land,
potentially including relational graph, projected-fact risk class, local graph
evaluation, windowed query, individual mutation verbs, derived/search profile,
production composition, identity/effect adapter, and hosted target/scale.
Every fact names target, carrier, authority posture, bounds, package/source
publication, and evidence receipt.

Compatibility rules:

- Existing query references and LLP 0166 fragment stores continue unchanged.
  New graph/fact profiles use new identities and addresses.
- No retained fragment is relabeled as a projected fact. Adoption is
  prove-or-fresh and preserves pending intent or refuses.
- Plan, expression, and materialization changes rotate identity and retire
  predecessors through existing lifecycle rules.
- Graph v2 may be online-only; D3 local evaluation is separately published.
- Handwritten optimistic reducers remain supported at their honest weaker
  class and do not count as one-authored parity.
- Existing JS handlers remain server functions and do not become browser-
  executable through this RFC.
- Existing auth, route, action, job, asset, and target claims remain unchanged
  until their owners promote a new profile.

## Alternatives considered

### Stop at the current-surface control

Adopted as evidence, rejected as the predetermined final answer. It may prove
more capable than expected, but any manual joins, broad read models, parallel
caches, duplicate reducers, or one-off service glue remain measured product
burden. The program should remove only the workarounds whose replacement earns
owner admission.

### Copy Zero's architecture

Rejected. Whole-row custody, logical replication, mandatory cache service,
app-owned PostgreSQL, and same-by-convention execution are not necessary
product outcomes and conflict with accepted Snapback boundaries.

### Add raw SQL, arbitrary local query ASTs, or complete-table replication

Rejected. These weaken target portability, work admission, revocation, local
custody, and dual-evaluator conformance before bounded alternatives have been
measured.

### Admit arbitrary app-authored client mutators

Rejected. Current generated IR already closes part of the historical gap. LLP
0129 requires measured inexpressibility and per-verb evidence before widening
the drift and authority surface.

### Require every production edge to be native Snapback

Rejected. The pinned Zero application itself uses application-server services
outside the Zero sync engine. A supported, versioned, coherently operated
composition is the relevant product boundary. Undeclared custom glue still
does not qualify.

### Select PostgreSQL before running the fixture

Rejected. The application and large-data evidence should determine whether a
new target is necessary. Portability remains part of the desired outcome.

## Risks and counterweights

- **The graph grows into a second general database language.** Keep finite node
  classes, explicit bounds, application-derived admission, portable lowering,
  and stable refusal.
- **Projected facts leak or fabricate coherence.** Stage exact public reuse
  before projection subsumption or protected/private classes; include
  authority/policy/version in identity; require adversarial negative-delivery
  and retirement evidence.
- **Server and local evaluators drift.** Use one versioned IR, canonical-value
  and ordering corpus, fuzzing, identity fencing, and cross-checks.
- **The benchmark overfits Snapback.** Name general node/IR classes and require
  at least Triage, Fleet, and one non-issue-tracker witness before broad
  promotion; Zerobugs alone authorizes no app-named primitive.
- **Virtual windows hide incomplete data.** Keep whole, prefix, window, unknown,
  and refused distinct; make every interval inspectable; require proof for
  not-found.
- **Mutation IR becomes arbitrary code.** Preserve LLP 0129's measured gaps,
  deterministic closed effects, bounded work, no ambient capabilities, and
  server-only fallback.
- **Maintained search/derived data amplifies writes.** Require affected-output
  proofs, summed ceilings, incremental maintenance, rebuild receipts, and
  refusal of unbounded aggregation.
- **Composition components bypass authority.** Require a declared route/effect
  taxonomy, shared identity, explicit auth, bounded input/output, restricted
  secrets, durable receipts, and hosted adversarial tests.
- **Client bundle/storage cost becomes unacceptable.** Attribute bundle and
  fact/edge bytes, exercise eviction in a real browser, and degrade explicitly
  to server evaluation.
- **The parity claim becomes benchmark theater.** Freeze source, margins, and a
  primary improvement before capability implementation; retain raw results and
  immutable first attempts; forbid composite scores and silent omissions.

## Open questions

1. What graph-node and summed-work ceilings do the normal and large fixtures
   justify?
2. Which D3 class is sufficient for a first useful capability, and which
   classes are required for the whole-app claim?
3. Can compatible projections share facts without presenting a version-coherent
   graph that never existed?
4. What compact proof represents relationship absence and a complete indexed
   browser range?
5. Which graph nodes support incremental live deltas rather than replacement
   or resnapshot?
6. Must first-claim search work locally, or may it report honest offline
   unavailability?
7. Which pinned mutations remain inexpressible after lowering to current IR?
8. For which tables, if any, should an owner admit server-validated client ids?
9. Which production edges should be native and which belong in a packaged
   companion?
10. Which identity, notification, asset, and hosted-target adapters provide the
    first production witnesses?
11. What predeclared custody or operational threshold would support a
    defensible “better” claim?
12. Which non-issue-tracker application prevents overfitting before broad
    graph/projected-fact promotion?
13. Who owns whole-program orchestration and each delegated owner amendment?

## Status

Author ruling (Charlie, 2026-08-06, sitting #4): an LLP 0005 review
loop scaled to foundational product work is commissioned before the
Decision-requested acceptance is taken up; owner-Specs for D-workstreams
are named as each workstream starts, not all upfront.

Draft. Stage 0 (freeze and reconcile) was executed on 2026-08-05: LLP 0182's
claims were re-verified against the pin and 0182 is Active with four factual
corrections (`demos/zerobugs/stage0/0182-claim-verification.v1.md`); the D1
acceptance manifest is frozen with performance margins explicitly deferred to
`acceptance.v2` pending variability trials
(`demos/zerobugs/manifest/acceptance.v1.md`); the exact demand inventory and
workstream owner/dependency/timebox plan are recorded
(`demos/zerobugs/stage0/inventory.v1.md`,
`demos/zerobugs/stage0/program-plan.v1.md`). Stage 0.5 (the D1
current-surface control) completed on 2026-08-07: all eight ZB gates carry
immutable receipts with honest PASS/GAP/FAIL rows, the large profile is
qualified at 5.5M rows on the repaired runtime, ZB2's browser rows run in
real Chrome, and the hot profile's attempt ladder is receipted
(`demos/zerobugs/control/PLAN.md` §Lane F / §Lane 8 hold the ledger).

Author rulings (Charlie, 2026-08-07, recorded in
`demos/zerobugs/manifest/ratification-13.v1.md`): OQ13 — the current
orchestration pattern continues (supervising agent sessions orchestrate
lanes end to end; the author gates rulings, acceptances, and owner-Spec
naming at sittings); the durable-disconnected-intent primary-improvement
candidate is ratified as proposed before results are known, contingent on
the Stage 2 / D3–D5 offline-intent integration (the control shows zero
queued intent in this application shape today); D3 is the first
workstream, its owner-Spec author named at start per the sitting #4
ruling; and the LLP 0005 review loop scaled to foundational product work
is commissioned now, with Stage 0.5's receipts as evidence — acceptance
follows the loop. Independent mechanisms are still reviewed in their owner
documents rather than accreting implementation detail here.

2026-08-08: the hot profile qualified at its predeclared boundary
(`snapback-control-hot.zb5.v10.json`, PASS 21 / GAP 3 / FAIL 0) after the
runtime invalidation repair, closing Stage 0.5 completely. The learnings
sweep converted the control's remaining recorded friction into filed
tickets — the minutes-scale live-query re-evaluation cost under fan-out
(D2/D4 evidence), the sessions-store copy/keyring-sibling semantics, the
handler settlement-identity seam (D5/D7), numeric identity columns and
stored enum domains (W-SHORTID/W-ENUM removal paths), route-group
argument lowering (W-QGROUP root), and three guide-gaps (declared-refusal
discoverability, principal↔app-identity binding, the SVG asset adapter) —
see `issues/20260808-*`. These tickets plus the round-1 dual-family
review concerns (`llp/reviews/0183-zerobugs-quality-surface.{claude,gpt-5}.md`,
both revise-and-stay-Draft) are the queued inputs to the commissioned
revision round.
