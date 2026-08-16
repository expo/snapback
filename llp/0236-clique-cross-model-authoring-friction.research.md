# LLP 0236: Clique cross-model authoring friction

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Benchmarks, Agent experience, Developer
experience, Auth, Application data API, Live Queries, Ephemeral state, React,
Offline sync, Assets, Memberships, Code generation, Runtime, Packaging,
Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-15 (records the landed take-ceiling generation-time
refusal, `34d98f489`, in the closed-corrections table). 2026-08-15 (adds R7, the cross-lane group-authority
expressiveness synthesis: the missing declarative membership/role rule, the
sanctioned elevated-read and principal-array seams with their landed partial
corrections, and the cross-control evidence that no evaluated backend supplies
a declarative group answer; routed to LLP 0240). 2026-08-15 (adds the Snapback 0.1.21 Explicit/Familiar follow-up,
separates observed-and-landed corrections from the residual product agenda,
and treats Simplified as outside this improvement synthesis without changing
its governing LLP status). 2026-08-12 (post-snapshot routing amendment: records
provisional later Sonnet/Kimi successor findings without upgrading cross-model
confidence, and routes them to LLPs 0245–0249). 2026-08-12 (mechanically
renumbered from LLP 0234 to LLP 0236 after origin assigned LLPs 0234–0235).
2026-08-12 (initial Draft: synthesizes the completed Fable 5, Opus 5, and
GPT-5.6 sol paired exploratory lanes, the in-progress Sonnet 5 Snapback lane,
the LLP 0201 P2 pilot, and the surrounding comparative diaries)
**Related:** LLP 0016, LLP 0061, LLP 0074, LLP 0108, LLP 0115, LLP 0116,
LLP 0118, LLP 0119, LLP 0120, LLP 0122, LLP 0123, LLP 0131, LLP 0146,
LLP 0151, LLP 0155, LLP 0178, LLP 0189, LLP 0193, LLP 0198, LLP 0201,
LLP 0208, LLP 0210, LLP 0218, LLP 0219, LLP 0220, LLP 0221, LLP 0229,
LLP 0238, LLP 0240, LLP 0241, LLP 0243, LLP 0245, LLP 0246, LLP 0247,
LLP 0248, LLP 0249, LLP 0252, LLP 0253,
Diary 0039, Diary 0057, Diary 0058 (both slugs), Diary 0059, Diary 0060,
Diary 0067, Diary 0070, Diary 0071, Diary 0073, Diary 0074, Diary 0075,
Diary 0076 (pre-publication at research time), Diary 0078, Diary 0079,
Diary 0080, Diary 0081, Diary 0082, Diary 0083, Diary 0084, Diary 0085

## Summary

The Clique benchmark and the surrounding Snapback-versus-Convex diary series
now contain enough independent builder evidence to distinguish structural
product strengths from one agent's preferences. The clearest synthesis is:

> Convex is smoother by default; Snapback is stronger when explicit
> authority, proof, ephemeral state, offline writes, and day-two evolution
> matter.

Snapback's core earns unusually consistent praise. Builders value its
remediation-bearing refusals, served build-bound guide, server-derived
authority, exact generated contracts, arbitrary JavaScript live projections,
first-class ephemeral state, deterministic acceptance loop, and fail-closed
artifact identity. Its problems cluster at the seams around that core:
password authentication, restricted handler JavaScript, asset authoring and
delivery, React hook semantics, custom authority integration, schema
expressiveness, protected offline reads, generated-artifact lifecycle, and
operational concepts that are individually defensible but collectively form a
narrow doorway.

This is a descriptive research snapshot, not a new closure plan. LLP 0208
continues to own the original pilot's gap register, and each problem below
routes to its existing subsystem owner where one exists. Some pilot gaps have
already been fixed; retaining the original observation is still useful because
the finding explains what builders notice and supplies a regression target.

## Evidence boundary

### Runs included

This synthesis reads five evidence layers:

1. The seven-application current-main Snapback/Convex workout, summarized in
   [Diary 0039](../diaries/0039-snapback-convex-main-rerun-report.diary.md#executive-answer).
2. The full LLP 0201 P2 Clique pilot across Snapback, Convex, and Supabase,
   summarized in
   [Diary 0073](../diaries/0073-clique-p2-pilot.diary.md#what-one-sentence-per-lane-would-say).
3. The 2026-08-11/12 seven-model exploratory sweep commissioned by
   [LLP 0201's dated amendment](./0201-social-messenger-canonical-benchmark.plan.md#dated-amendments).
   At this snapshot, Fable 5, Opus 5, and GPT-5.6 sol had completed paired
   Snapback/Convex M1-M3 lanes; Sonnet 5's Snapback lane was in progress;
   Terra, Grok, and Kimi had no diary yet.
4. The messaging, auth, asset, local-first, and authoring-loop diaries that
   reproduce individual findings outside Clique.
5. The in-progress first-class password-auth acceptance diary, used only to
   distinguish a promising new core from a complete public product surface.

The live exploratory diaries had not yet been published into this repository
when this Research was written. Their pre-publication primary paths on the
reserved run machine are:

- `/Users/ccheever/clique-sweep/lanes/fable5-snapback/{diary,essay}.md`
- `/Users/ccheever/clique-sweep/lanes/fable5-convex/{diary,essay}.md`
- `/Users/ccheever/clique-sweep/lanes/opus5-snapback/{diary,essay}.md`
- `/Users/ccheever/clique-sweep/lanes/opus5-convex/{diary,essay}.md`
- `/Users/ccheever/clique-sweep/lanes/sol-snapback/{diary,essay}.md`
- `/Users/ccheever/clique-sweep/lanes/sol-convex/{diary,essay}.md`
- `/Users/ccheever/clique-sweep/lanes/sonnet5-snapback/run-log.md`

Every finding below therefore also links a durable in-repository diary example.
When the sweep publishes, revise this document to replace the pre-publication
paths with repository-relative links; do not silently promote the N=1 sweep
into a comparative claim.

### Claim posture

The exploratory sweep is calibration-labeled and N=1 per cell. Its repeated
observations increase confidence that an affordance or failure mode is
discoverable across model families; they do not establish population rankings,
token-efficiency claims, or a scored winner. The P2 pilot's builder scores are
also not claim-eligible. LLP 0189 and LLP 0201 govern any later publication.

### Confidence vocabulary

- **Convergent:** independently observed by at least two isolated builders or
  sessions.
- **Repeated:** appears in multiple diaries, but the builders or configurations
  are not fully independent.
- **Single-run:** one concrete observation that should shape a probe or ticket,
  not a general product claim.
- **Historical:** the observation was valid for its pinned version but a later
  landing may have closed it.

## Comparative findings

### Convex remains the smoother conventional TypeScript default

Convex's schema, validators, server functions, generated references, local or
hosted development loop, and React subscriptions feel like one inferred
TypeScript product. Ordinary queries are reactive without a separate live
classification, helpers compose normally, and basic assets use a short upload
URL flow. The seven-app workout judged the exact workloads approximately 55/45
for Convex and described the remaining distinction as mature inferred
TypeScript versus Snapback's explicit contracts and framework/runtime edges
([Diary 0039, Executive answer](../diaries/0039-snapback-convex-main-rerun-report.diary.md#executive-answer)).

The recent Expo messaging bakeoff reached the same practical conclusion:
Convex won the current build 86/84 because its cloud operations and ordinary
image path were more mature, while Snapback won the projected mature-product
comparison 97/96 because of its local-first and ephemeral semantics
([Diary 0058, Outcome](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#outcome),
[Current scores](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#current-scores)).

### Snapback's explicitness buys real review and trust properties

Snapback asks authors to declare table visibility, function authority, reads,
writes, result contracts, index use, collection bounds, asset policy, and
capabilities. That is more surface than Convex, but it makes the answer to
"who can do this, what can it touch, and what crosses the wire?" inspectable.
The workout found Snapback stronger on owner/constraint evidence, emitted
transaction evidence, deterministic scheduled-work proof, and portable search
contracts even where Convex remained terser
([Diary 0039, workouts 1-7](../diaries/0039-snapback-convex-main-rerun-report.diary.md#results-by-workout)).

Pointing Room gives the sharpest security example. A cross-table disclosure
query returns `null` to the non-owner until reveal, then releases the value to
both principals; the acceptance reads the actual HTTP/WebSocket bytes rather
than trusting UI hiding. Convex can express a similar server query, but
Snapback's explicit read set, result contract, field-boundary declaration, and
wire proof make the rule unusually reviewable
([Diary 0074, Slice 1](../diaries/0074-pointing-room.diary.md#slice-1--cross-table-disclosure),
[Slice 4](../diaries/0074-pointing-room.diary.md#slice-4--declared-field-boundary-2026-08-11)).

### Ephemeral state is Snapback's clearest product advantage

Every comparison that exercises cursor- or typing-rate state reaches the same
result. Snapback declares a connection-owned collection with a value contract,
TTL, latest-state delivery, and rate budget; disconnect cleanup is platform
semantics and durable storage does not advance. Convex approximates the same
behavior with durable heartbeat rows, client or scheduled cleanup, and database
writes for values whose identity is "evaporates shortly."

The seven-app workout called this Snapback's decisive win
([Diary 0039, Cursor Garden](../diaries/0039-snapback-convex-main-rerun-report.diary.md#4-cursor-garden--high-frequency-presence)).
The paired messaging bakeoff scored realtime plus typing 95/80 for Snapback
([Diary 0058, Current scores](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#current-scores)).
The focused messenger diary independently praised the typed TTL lane while
recording naming/documentation friction
([Diary 0058, What felt good](../diaries/0058-messaging-snapback.diary.md#what-felt-good),
[Ephemeral naming correction](../diaries/0058-messaging-snapback.diary.md#2026-08-06--ephemeralpresence-naming-correction)).

### Snapback's offline advantage is asymmetric

Snapback's durable ordered mutation outbox, idempotent replay, optimistic
intent machinery, binding receipts, and explicit retention classification are
substantial advantages. Convex's React Native arm supplied neither a persistent
query cache nor an offline mutation protocol in the messaging comparison, so
the app wrote its own snapshot cache and disabled writes offline
([Diary 0058, Convex application machinery](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#0407--where-convex-needed-application-machinery)).

But Snapback's JS arm does not cold-retain ordinary protected data. Clique's
private chat cache was therefore also hand-written; Snapback decisively won
offline writes, not the whole offline problem. The pilot states this split
directly
([Diary 0073, convergent finding 2](../diaries/0073-clique-p2-pilot.diary.md#the-convergent-findings-what-the-pilot-was-for)),
and the browser witness shows how much authority, receipt, and reconnect
machinery is needed to prove even the supported public-retention case
([Diary 0067, What I built](../diaries/0067-browser-local-first-public-witness.diary.md#what-i-built),
[first green run](../diaries/0067-browser-local-first-public-witness.diary.md#2026-08-07--first-green-run-and-the-three-defects-the-carrier-was-hiding)).

### Snapback appears strongest on day two

The full pilot's holistic ordering favored Convex 78/72, but its isolated
day-two score favored Snapback 90/82. The fresh engineer described Snapback's
path as declare, migrate, regenerate, and verify the data remained intact
([Diary 0073, findings 3-4](../diaries/0073-clique-p2-pilot.diary.md#the-convergent-findings-what-the-pilot-was-for)).
This inversion matters: the declarations and artifact graph that feel like
ceremony on day one become leverage when the schema and read models evolve.

## Snapback problem register

### P1. Password authentication is still the largest product-shaped gap

**Confidence:** convergent across all completed Snapback Clique builders.

The pinned public package has strong sessions, principals, server-derived
authority, refresh, custody, and revocation, but no witnessed password
credential path and no production email-code delivery. Every completed sweep
builder implemented a trusted scrypt front door. Once the browser exchanged a
one-use code, Snapback correctly resumed ownership of the session lifecycle;
the missing piece was nevertheless security-critical product infrastructure.

The original pilot called auth its largest score floor and hand-rolled a
roughly 200-line broker
([Diary 0073, Snapback sentence and gap list](../diaries/0073-clique-p2-pilot.diary.md#what-one-sentence-per-lane-would-say)).
The browser-auth recipe demonstrates the sanctioned composition but explicitly
does not claim a production broker or provider
([Diary 0071, Boundary](../diaries/0071-browser-auth-recipe.diary.md#boundary-and-follow-up)).
The chess workout separately found the surrounding authority model excellent
while recording auth-surface and package/guide mismatches
([Diary 0057, What felt good](../diaries/0057-chess-backend-bakeoff.diary.md#what-felt-good),
[What felt bad](../diaries/0057-chess-backend-bakeoff.diary.md#what-felt-bad-or-surprising)).

The in-progress first-class password implementation should not be described as
closed merely because component rows pass. Its current acceptance diary reports
an activation-mode mismatch, a predecessor-password signin/change race, CLI
protocol negotiation failure, physical and logical transfer failures, missing
admin lock-state observation, and incomplete real-browser evidence. That diary
was still pre-publication at this snapshot; its local source is
`diaries/0076-password-auth-acceptance.diary.md` in the password-auth worktree.

**Product implication:** finish the public credential path end to end before
optimizing adjacent auth ergonomics. A skeptical app must be able to select the
identifier mode, sign up, sign in, change and recover credentials, observe and
clear lockout, back up and restore, and use the same path from clients and CLI.

### P2. The handler environment violates ordinary JavaScript expectations

**Confidence:** convergent.

Snapback inline handlers are a closed deterministic dialect, not general Node
or ordinary bundled TypeScript. Builders repeatedly attempted imports,
computed member access, array indexing, typed arrays, reusable captured helpers,
or Node crypto. Generate-time refusals were usually excellent, but agents only
learned the boundary after writing idiomatic code.

The seven-app workout records duplicated calendar logic because a self-contained
handler could not capture a helper
([Diary 0039, Streak Lab](../diaries/0039-snapback-convex-main-rerun-report.diary.md#1-streak-lab--owner-scope-and-derived-analytics))
and makes helper composition a prioritized correction
([Diary 0039, Generalize composition](../diaries/0039-snapback-convex-main-rerun-report.diary.md#p1--generalize-composition-without-losing-evidence)).
The chess build had to read framework source to discover the actual banned
syntax and import boundary
([Diary 0057, reading the guide](../diaries/0057-chess-backend-bakeoff.diary.md#2105--reading-the-guide-four-questions-answered-one-of-them-badly)).
The first-class recipient-grant diary again hit computed-property restrictions
inside otherwise ordinary policy code
([Diary 0058, view-once grants](../diaries/0058-messaging-snapback.diary.md#2026-08-10--view-once-on-first-class-recipient-grants-llp-0220-d3)).

**Product implication:** preserve the portable deterministic boundary, but make
it legible before authoring and provide a safe helper/module composition story.
The most damaging state is not refusal; it is an agent treating the runtime as
Node until a late integration forces architectural extraction.

### P3. Asset policy is stronger than asset ergonomics

**Confidence:** repeated, with several historical sub-findings already closed.

Snapback's typed asset references, upload intents, trusted finalization,
variants, atomic attachment, recipient grants, revocation, and server-side
delivery denial are materially stronger than Convex's basic capability-URL
path. The problem is reaching those semantics through ordinary app APIs.

Repeated examples include one asset per command, multi-image posts requiring
raw upload plus a mutation, direct mobile upload authority ceremony, missing or
surprising video URL behavior, empty-ID hook crashes, signed-URL probing, and
variant-selection surprises. The focused Expo comparison describes Snapback's
policy as stronger while scoring current asset ergonomics 82 versus Convex's 92
([Diary 0058, Snapback asset proof](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#0353--snapback-backend-proof-including-real-bytes),
[Current scores](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#current-scores)).
Tandem likewise calls assets the largest Snapback frustration despite valuing
the ownership contract
([Diary 0059, Snapback experience](../diaries/0059-tandem-expo-messaging-bakeoff.diary.md#snapback-experience)).
The messenger diary records the original dev-mode upload identity gap and the
later first-class recipient-grant improvement
([Diary 0058, What felt bad](../diaries/0058-messaging-snapback.diary.md#what-felt-bad--surprising),
[recipient grants](../diaries/0058-messaging-snapback.diary.md#2026-08-10--view-once-on-first-class-recipient-grants-llp-0220-d3)).

The active Sonnet sweep lane adds two single-run diagnostic defects in 0.1.20:
`optional:false` on a command asset slot and an unexported top-level mutation
constant both reduced to unattributed
`SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE`, requiring package-source
bisection.

**Product implication:** treat the policy substrate and app-facing wrappers as
separate quality bars. The former is a differentiator; the latter should make
one image, several images, optional media, and video all unsurprising without
forcing authors to learn lower-level transport routes.

### P4. React and headless client semantics are correct but easy to misread

**Confidence:** convergent.

The recurring mistakes are specific:

- `useSnapbackQuery` accepts live references, not ordinary queries.
- A headless live-query handle is `rows` + `poll()` + `dispose()`, not an async
  iterator, and requires a connection identity.
- `useSnapbackMutation` returns a dispatch outcome because a queued write may
  not have a server result yet; callers nevertheless expect the result.
- Inline argument objects and per-render presence values churn subscriptions.
  In the pilot this saturated the browser main thread until clicks stopped,
  with no diagnostic.
- Presence projections and lower-level state have used vocabulary such as
  `entries` and `members` inconsistently.

Tiny Triumphs records the async-iterator mistake and the documented correction
([Diary 0075, Build log](../diaries/0075-tiny-triumphs.diary.md#build-log)).
The full pilot independently rediscovered the outbox settlement problem in its
builder and fresh-engineer sessions
([Diary 0073, convergent finding 1](../diaries/0073-clique-p2-pilot.diary.md#the-convergent-findings-what-the-pilot-was-for)).
The browser witness records the newer provider-owned drain and dispatch-union
shape
([Diary 0067, React queued resolution](../diaries/0067-browser-local-first-public-witness.diary.md#2026-08-10--react-queued-resolution-and-provider-owned-drain)).

**Product implication:** keep the truthful dispatch union, but make the common
settled-result path obvious and queued state impossible to mistake for commit.
Add development diagnostics for resubscribe storms and put reference-kind,
connection, and handle-lifecycle requirements at the call sites where agents
need them.

### P5. Authentication client discovery and typing lag the runtime

**Confidence:** convergent in the current sweep; corroborated by earlier auth
diaries.

Completed sweep builders found runtime auth methods absent from published
TypeScript declarations and could not locate a documented "who am I?" path.
One discovered `AuthCoordinator.settledView()` by enumerating prototype
methods. Other diaries show the same larger pattern: the custody model is
excellent once reached, but browser relay, protocol headers, and privileged
carrier boundaries demand substantial surface knowledge.

The browser-auth recipe praises coordinator-owned reload/logout and
server-derived `ctx.auth.userId` while recording the binder and gateway seam
([Diary 0071, What felt good](../diaries/0071-browser-auth-recipe.diary.md#what-felt-good),
[What felt hard](../diaries/0071-browser-auth-recipe.diary.md#what-felt-hard-or-surprising)).
Pointing Room initially had to learn its safe browser mailbox relay from demo
source rather than the sessions page
([Diary 0074, Slice 1 guide gaps](../diaries/0074-pointing-room.diary.md#slice-1--cross-table-disclosure)).

**Product implication:** publish and type the complete client auth surface,
including an explicit current-session/current-principal projection. An auth
model this rigorous should not require method enumeration or raw-route probing.

### P6. Declared membership and custom product rosters do not compose cheaply

**Confidence:** repeated.

Snapback's declared membership machine is intentionally closed: private roster,
controlled transitions, bootstrap-owned creation, and bounded commands. Clique
needed a visible roster with promotable admins while membership-visible search
and asset policy wanted the declared machine. The pilot therefore maintained a
product roster and declared seats in parallel across several mutations.

The original pilot digest identifies follower joins, password auth, and offline
protected reads as Snapback-specific hand-built work
([Diary 0073, convergent finding 2](../diaries/0073-clique-p2-pilot.diary.md#the-convergent-findings-what-the-pilot-was-for)).
Pointing Room provides the positive contrast: where the authority rule fits a
server-side live projection, Snapback makes a cross-table disclosure boundary
easy to state and prove
([Diary 0074, Slice 2](../diaries/0074-pointing-room.diary.md#slice-2--room-scoped-keyed-queries)).

**Product implication:** do not weaken the closed authority machine. Supply a
paved bridge: readable roster projection, sanctioned mirror, product-role
mapping, or app-bound membership profile. Custom function-mediated authority
also needs a declaration that can clear visibility warnings without falsely
claiming owner- or membership-row enforcement.

### P7. Schema and validator gaps deform otherwise natural models

**Confidence:** repeated; some sub-findings are historical.

Stored arrays and nested structures repeatedly became child tables, fixed
`image1`...`image4` columns, or `v.json()`. Historically, unique-on-optional
fields and deeply nested mutation arguments also required workarounds. These
choices weaken generated types and make the app schema reflect framework
limits rather than the domain.

The seven-app workout records `v.json()` plus manual validation for a split
vector where Convex uses `v.array(v.object(...))`
([Diary 0039, Split Ledger](../diaries/0039-snapback-convex-main-rerun-report.diary.md#5-split-ledger--nested-inputs-atomic-rows-and-aggregation)).
The focused messenger diary records missing array guidance and the raw-row
result-contract footgun
([Diary 0058, What felt bad](../diaries/0058-messaging-snapback.diary.md#what-felt-bad--surprising)).
LLP 0208 records which original G8 sub-findings have since landed and which
remain design constraints
([LLP 0208, G8](./0208-clique-pilot-gap-closure.plan.md#g8-schema-expressiveness-stored-arrays-and-unique-on-optional)).

**Product implication:** measure success by whether common bounded domain
values retain exact generated types, not merely whether `v.json()` can carry
them. Continue preserving special handling for authority-bearing asset refs.

### P8. Protected offline reads remain an application responsibility on React

**Confidence:** convergent across the full pilot and messaging bakeoffs.

Snapback's JS client can durably queue writes and retain authority-independent
public queries, but an ordinary private-chat query is not safely cold-retainable.
Clique therefore implemented its own local snapshot for chats, messages,
search, and selected media. That is still better than Convex when offline writes
matter, but it prevents a broad claim that Snapback supplies offline behavior
for a conventional authenticated app.

The paired Expo diary carefully distinguishes Snapback's retained public query
plus outbox from Convex's wholly app-authored cache
([Diary 0058, Outcome](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#outcome)).
The browser witness exposes the sessions/dev-mode distinctions and authority
invalidation requirements beneath that claim
([Diary 0067, retention refusal](../diaries/0067-browser-local-first-public-witness.diary.md#2026-08-07--retention-refusal-needs-two-server-modes)).

**Product implication:** either ship a bounded, policy-aware React snapshot
helper or keep the GAP conspicuous. The helper must preserve user-switch wipe,
permission invalidation, view-once exclusion, expiry, and binding provenance;
a generic query cache would overclaim safety.

### P9. Artifact identity is excellent protection with a noticeable lifecycle tax

**Confidence:** repeated.

Digest-bound generated artifacts prevent stale schema/functions/client
references from partially working. Builders explicitly praised
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` because it converted mysterious drift
into a named diagnosis. The same mechanism repeatedly caught long-running
gateways or relays holding stale `api.mjs`, documentation-only changes altering
bundles, and readiness receipts drifting from the selected runtime.

Tandem records a documentation-only `@ref` changing function identity and
making state rollover expensive
([Diary 0059, Snapback experience](../diaries/0059-tandem-expo-messaging-bakeoff.diary.md#snapback-experience)).
Pointing Room needed a current-tree temporary binary and coherent readiness
receipt when its chartered binary drifted
([Diary 0074, Slice 4](../diaries/0074-pointing-room.diary.md#slice-4--declared-field-boundary-2026-08-11)).
The seven-app workout names native artifact diagnosis and relinking as the
largest first-hour confidence cost
([Diary 0039, runtime readiness](../diaries/0039-snapback-convex-main-rerun-report.diary.md#p0--make-external-adoption-and-runtime-readiness-boring)).

**Product implication:** preserve fail-closed identity, but make reload custody
boring: generated module clients and carrier readers should refresh at safe
boundaries, documentation-only changes should not perturb executable identity,
and doctor/bootstrap/dev should share one recovery model.

### P10. Query composition is capable but not uniformly paved

**Confidence:** repeated, with version-dependent improvements.

JavaScript live queries are a strong escape hatch, but the stable declarative
relational surface has historically been too narrow for follower feeds,
multi-level aggregates, children/activity projections, and count backfills.
Convex has the opposite problem: arbitrary reactive query functions are easy,
but scalable follower feeds require fan-out or N-way cursor merges because the
database has no relational planner.

The current-main workout records imperative aggregation and narrow relational
fit in Relay Board and Split Ledger
([Diary 0039, Relay Board](../diaries/0039-snapback-convex-main-rerun-report.diary.md#2-relay-board--related-data-and-atomic-audit),
[Split Ledger](../diaries/0039-snapback-convex-main-rerun-report.diary.md#5-split-ledger--nested-inputs-atomic-rows-and-aggregation)).
It also records real progress: indexed range/order/take removed the old
whole-room pagination criticism, and indexed full-text search now exists
([Diary 0039, Campfire](../diaries/0039-snapback-convex-main-rerun-report.diary.md#3-campfire--pagination-reactions-and-realtime),
[Pantry Search](../diaries/0039-snapback-convex-main-rerun-report.diary.md#6-pantry-search--indexed-text-search)).

**Product implication:** the target is not SQL breadth. Stabilize the common
bounded children, aggregate, activity, and feed shapes while retaining declared
cost and authorization. Keep JS projections as the honest general escape hatch.

### P11. Errors are excellent on refusal paths and weak outside them

**Confidence:** convergent for the bimodal pattern; individual codes vary.

The most repeated positive observation in the whole corpus is that refusals
teach the repair. The corresponding negative observation is that failures
outside the structured refusal layer can demand long bisection: generic
`SNAPBACK_HANDLER_FAILED`, silent resubscribe storms, queue-state ambiguity,
empty asset hooks crashing render, or unattributed definition serialization.

LLP 0208 identifies this as a 90-grade refusal surface beside 30-grade runtime
and client failure zones
([LLP 0208, Summary](./0208-clique-pilot-gap-closure.plan.md#summary)).
The chess diary shows both sides in one run: fast precise codegen loops, then
published-package and guide drift that forced source inspection
([Diary 0057, codegen](../diaries/0057-chess-backend-bakeoff.diary.md#2114--codegen-four-rounds-all-of-them-fast),
[What felt bad](../diaries/0057-chess-backend-bakeoff.diary.md#what-felt-bad-or-surprising)).

**Product implication:** LLP 0193 should measure completeness by user-visible
failure classes, not merely the population of `SNAPBACK_*` codes. The standard
set by generate-time refusals should extend to handler runtime, React lifecycle,
asset wrappers, auth negotiation, and codegen definition attribution.

### P12. The guide is excellent, but missing one point-of-need link can create a false capability conclusion

**Confidence:** repeated.

Builders consistently praise the guide's intent index, capability GAP rows,
version binding, and honesty. Yet Pointing Room initially concluded that native
Contract presence publication was impossible and wrote host glue because the
capability existed without a reachable worked path. Slice 2 corrected the
conclusion and identified a guide gap rather than a product gap
([Diary 0074, Slice 1 correction](../diaries/0074-pointing-room.diary.md#slice-1--cross-table-disclosure),
[Slice 2](../diaries/0074-pointing-room.diary.md#slice-2--room-scoped-keyed-queries)).

Other examples include learning handler restrictions from refusals, learning
the React live-only rule at runtime, finding browser session relay in demo
source, and discovering invariant grammar in package tests. Tiny Triumphs adds
an npm-only issue: optional generated Contract metadata imports
`@exact/contract/exports`, which is not publicly installable, so an app that
does not use Contract must exclude that directory from broad TypeScript checks
([Diary 0075, Build log](../diaries/0075-tiny-triumphs.diary.md#build-log)).

**Product implication:** capability discoverability needs path coverage, not
just truthful pages. Every generated surface should link its call-site guide;
every guide recipe should be tested against the published npm closure; and a
documented escape hatch should appear before the restriction that requires it.

### P13. The integrated local loop is powerful but operationally novel

**Confidence:** repeated.

Snapback's supervisor, ready descriptors, packaged runtime, doctor vertical
slice, disposable acceptance server, reset protocol, and inspection surfaces
are collectively one of its strengths. The cost is the number of concepts a
builder must understand: backend and Metro carriers, generated manifests,
session custody, runtime readiness receipts, binding sources, retainability,
outbox state, and the distinction between product acceptance and D1-complete
conformance.

The paired Expo comparison says this surface was much larger than Convex's and
that the managed dev loop failed for that app even though the backend itself
worked through a manual launcher
([Diary 0058, managed loop](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#0350--the-managed-snapback-dev-loop-is-broken-for-this-app),
[frustrations](../diaries/0058-relay-room-expo-backend-bakeoff.diary.md#what-frustrated-or-sidetracked-me)).
Tiny Triumphs shows the improved npm-first path but still requires both Metro
and the local backend to be exposed to a physical phone
([Diary 0075, Build log](../diaries/0075-tiny-triumphs.diary.md#build-log)).

**Product implication:** keep the rigorous machinery behind one increasingly
boring golden path. A healthy ordinary app should need to understand only the
next failing boundary; the full architecture should remain available for
inspection, not required as startup lore.

### P14. Verification is epistemically strong and cognitively expensive

**Confidence:** repeated.

Snapback distinguishes a product acceptance suite from a registered verification
profile and from D1-complete internal provenance. Builders respected that
distinction and praised receipts that state nonclaims. They also repeatedly
needed to learn why a green suite yielded `passed-without-acceptance`, why a
profile could rerun product checks but register zero D1-complete paths, or why
the frozen choreography could never aggregate green because required checks
were hard-coded unimplemented.

Tiny Triumphs records a correct `passed-without-acceptance` result despite a
separate 4/4 headless suite
([Diary 0075, Verification](../diaries/0075-tiny-triumphs.diary.md#verification)).
The Clique pilot records structurally unreachable choreography green as an
instrument defect rather than an app failure
([Diary 0073, Harness lessons](../diaries/0073-clique-p2-pilot.diary.md#harness-lessons-folded-back-tickets-filed)).

**Product implication:** retain honest nonclaims, but improve the bridge from
"my tests pass" to "register these exact claims." Verification status should
always separate app failure, platform failure, missing evidence, and instrument
incompleteness in its first summary line.

## What must not be optimized away

The problem register should not be used to flatten Snapback into a Convex
clone. Four qualities are load-bearing:

1. **Refusals as documentation.** The stable code, violated rule, source
   location, and repair are the fastest authoring loop models reported.
2. **Explicit authority and capability nonclaims.** Server-derived identity,
   declared reach, table visibility, result contracts, and honest GAP rows make
   trust review possible.
3. **First-class ephemeral state.** This is the clearest feature where Snapback
   is not merely different but better suited to the domain.
4. **Identity-bound evolution and proof.** Artifact identity, additive
   migrations, deterministic resets, real acceptance servers, and scoped
   verification receipts are why day two reverses the day-one ranking.

The right product direction is a wider doorway into these properties: better
defaults, discoverability, wrappers, composition, and diagnostics without
replacing explicit contracts with ambient inference.

## Priority synthesis

Based on recurrence, severity, and competitive leverage, the current sequence
should be:

1. Complete first-class password auth across activation, client, CLI,
   concurrency, lockout inspection, recovery, and transfer.
2. Make asset happy paths uniform across one image, several images, optional
   media, video, upload, delivery, and revocation.
3. Close the React/headless semantic traps: dispatch result access, queue
   visibility, hook identity churn, reference kinds, and connection lifecycle.
4. Publish a safe handler composition story and a complete restriction map.
5. Bridge custom product rosters/principals into declared authority without
   dual state or permanent warnings.
6. Preserve exact types for common bounded structured values and mutation
   inputs.
7. Supply or explicitly decline a policy-aware protected-read cache for the
   React arm.
8. Make artifact reload, runtime readiness, and physical-device development
   boring while preserving fail-closed identity.
9. Stabilize common bounded aggregate, children, activity, and feed query
   shapes.
10. Extend errors-as-docs from refusal paths into runtime and client lifecycle
    failures.

### Post-snapshot successor findings (provisional)

Later Sonnet and in-progress Kimi lanes arrived after the evidence snapshot
above. They do not change this Research document's confidence labels until the
complete sweep artifacts are imported and adjudicated, but they are concrete
enough to route without waiting:

- protected reads attempted while anonymous can destabilize the React auth gate
  and, in one isolated reproduction, poison a later valid auth exchange on the
  same client;
- optional own-property `undefined`, published-presence withdrawal, and
  one-shot refusal access remain surprising under ordinary TypeScript/React;
- a feed hydration fallback can require several `ctx.db` host calls per card;
- the portable engine is not a practical substitute for native/package compute
  such as a password KDF; and
- Expo scaffolds can let mutable `.snapback/` runtime state enter Metro's watch
  graph.

LLP 0238 and LLP 0241 receive evidence/acceptance clarifications for the defects
already inside their accepted intent. Draft LLP 0247 owns the new client
compatibility choices. Draft LLP 0248 owns bounded batch reads, and Draft LLP
0249 owns the explicit trusted package-action decision. The broader two gaps
this snapshot already left open—declaration transcription and direct
TypeScript helper custody—are Draft LLP 0245 and LLP 0246.

## Snapback 0.1.21 Explicit/Familiar follow-up — 2026-08-15

### Evidence and decision boundary

The 0.1.21 Clique follow-up adds one clean GPT-5.6 sol high lane for Familiar
and one for Explicit through M3, plus Convex, InstantDB, PocketBase, and an
aborted Supabase control. Both Snapback lanes reached green product acceptance
and frozen choreography for every implemented milestone check
([Familiar](../diaries/0079-clique-0121-snapback-familiar.diary.md),
[Explicit](../diaries/0083-clique-0121-snapback-explicit.diary.md)). The earlier
two-model Familiar/Convex pilot supplies independent replication for several
package, codegen, and runtime seams
([Diary 0078](../diaries/0078-clique-familiar-convex-pilot.diary.md)), but it
does not turn the new 0.1.21 cell into an N≥3 comparison. Opus 5 and Grok 4.6
did not produce comparable 0.1.21 application diaries because their provider
credentials failed before application work. These findings are therefore
directional product evidence, not a promotion, default, or competitive claim.
LLP 0252 D7 and LLP 0201 continue to govern those decisions.

Per the author direction for this revision, Simplified is a likely withdrawal
and is outside the improvement agenda below. This Research revision neither
invests in repairing it nor changes the status of any governing profile LLP.
The product question here is narrower: how should Snapback improve its Explicit
power lane and its Familiar ordinary lane without weakening the semantics both
share?

### What the new diaries change

Familiar's source experience is credible. Its schema, query, mutation, and
ephemeral vocabulary let the builder express Clique without importing
Explicit-profile application modules, and the generated guide was sufficient
to reach three green milestones. Explicit was also credible: declared
references, membership records, receipt snapshots, server-derived authority,
and ephemeral typing fit Clique naturally. Neither profile's central data
model was the dominant source of friction.

The wallclock evidence is the corrective. Familiar took 3,984 seconds from M1
through M3; Explicit took 3,960 seconds. The 24-second difference is noise in
these N=1 lanes, not evidence that Familiar is faster. Familiar removed source
ceremony, but package closure, generated-name grammar, auth transitions,
client/runtime convergence, and media workarounds consumed the savings.
Familiar can still become the easier doorway, but only if the whole first-party
journey becomes familiar—not merely the server declarations.

The controls also move the competitive baseline. Convex, InstantDB, and
PocketBase all made durable realtime application data comparatively ordinary
([Convex](../diaries/0085-clique-0121-convex.diary.md),
[InstantDB](../diaries/0084-clique-0121-instantdb.diary.md),
[PocketBase](../diaries/0082-clique-0121-pocketbase.diary.md)). Snapback should
not expect live data alone to differentiate it. Its leverage is the combination
those controls did not supply as one coherent system: explicit authority,
first-class ephemeral state, exact lifecycle truth, protected/offline
semantics, and verification that states its nonclaims. Supabase's lane failed
at credential preflight before it could serve as an application comparison
([Diary 0080](../diaries/0080-clique-0121-supabase.diary.md)); that is an
instrument/setup result, not a Supabase product result.

### Observations already closed after the run

Several diary complaints were valid at observation time and were then fixed on
main. They remain regression evidence, but must not be presented as the current
residual agenda:

| Observed friction | Landed correction | Required follow-up |
| --- | --- | --- |
| Familiar generated-directory disagreement, dotted operation names, and Metro-incompatible generated exports | LLP 0253 now defines one `snapback/generated/` root and one centralized name grammar; the corresponding [directory](../issues/closed/20260815-familiar-codegen-generated-directory-mismatch.md) and [operation-name](../issues/closed/20260815-generated-operation-name-seams-metro-and-client-grammar.md) defects are closed | Repeat the clean external-package build without copies, overlays, symlinks, or watcher exclusions |
| Familiar scalar query results and structured principal snapshots were rejected | The [schema expressiveness correction](../issues/closed/20260815-familiar-schema-expressiveness-refusals.md) adds exact lowering while preserving migration intent | Rerun the original one-row and receipt/member schema cases from the published package |
| Explicit descriptors were rejected by Expo admission and a hot-loaded function generation did not remint the supervised binding | [Descriptor parity](../issues/closed/20260815-explicit-descriptor-authoring-profile-rejected-by-expo-admission.md) and [binding remint](../issues/closed/20260815-hot-reload-does-not-remint-supervised-expo-binding.md) are closed under the common profile/generation contracts | Exercise both profiles through the same generation-change acceptance case |
| Logout could race authority clearing, and repeated short-lived authenticated clients could stall the backend | [Serialized logout](../issues/closed/20260815-logout-races-authority-clearing.md) and [headless auth churn](../issues/closed/20260815-headless-auth-churn-stalls-backend.md) are closed with lifecycle and stress coverage | Preserve them in the package-level Clique replay and long-lived provider test |
| A literal `take(4096)` was accepted at generation time and only failed as a runtime 400 against the 1024 ceiling (Diary 0078 M3) | The [take-limit correction](../issues/closed/20260815-take-limit-shared-rule-and-generation-refusal.md) makes an over-ceiling literal take a structured generation-time refusal, with the ceilings canonical in `@expo/snapback-contract/limits` and parity-locked at the codegen and runtime enforcement sites | Rerun the Diary 0078 M3 subscription case from the next published closure, which is the first to carry the refusal |
| Familiar could not name the derived video upload intent | LLP 0253 and the [video-intent correction](../issues/closed/20260815-familiar-video-asset-intent-unaddressable.md) add a same-profile nameable path | Validate real video selection, upload, delivery, and revocation rather than fixture-field reconstruction |
| Membership-protected resources could require duplicated or impossible handler-side authority reads | The [scoped elevated-read correction](../issues/closed/20260815-owner-visibility-filters-handler-reads-membership-authority-gap.md) supplies the bounded bootstrap/authorization path | Demonstrate the ordinary group pattern, including removal and negative cases, in both profiles |
| The guide did not provide one end-to-end Familiar journey | The [Familiar guide gap](../issues/closed/20260815-guide-gap-familiar-authoring-profile-page.md) is closed | Refresh the page after the media and membership corrections and test retrieval with a new builder |

“Closed” in this table means the implementation and local proof landed. It
does not mean the exact external npm Clique lanes have revalidated the
correction. Publication qualification and rerun evidence remain necessary.

### Residual product agenda shared by Familiar and Explicit

#### R1. Make auth and client bootstrap one first-party journey

The Explicit builder had to compose an application-owned `AuthCoordinator`
and call `adoptAuthority` because password-session creation and the supervised
Expo bearer were adjacent rather than integrated. Familiar hid more of the
declarations but encountered the same underlying transition and custody
system. A builder should be able to choose the first-party password provider,
create the generated client, and receive `currentPrincipal`, sign-in, sign-out,
and authority-change behavior from one documented composition. Web and native
session custody should be scaffolded separately and honestly: native defaults
must survive a process restart in secure device storage rather than only an
in-memory reload.

This should be an endorsed composition over LLP 0238/0247 lifecycle primitives,
not a second client protocol. Explicit applications must retain access to the
individual transitions, structured errors, and app-owned authority adoption
when they actually need them.

#### R2. Finish semantic generation convergence

LLP 0241's single-generation design is the right abstraction. The remaining
product test is experiential: a source edit should generate, load, remint the
binding, and update the client at a safe boundary without manual supervisor
restart, clean-copy overlays, symlinks, or Metro watch-graph surgery. Familiar
and Explicit must consume the same semantic generation pointer and the same
operation-name grammar. This is mostly a qualification and distribution task
after the landed corrections, but it is high priority because failures here
erase every source-level Familiar gain.

#### R3. Complete the media happy path

Both profiles reached for data URLs or schema-field reconstruction when the app
needed an ordinary avatar or video. A first-party happy path needs bounded
one-to-many media collections and an atomic media command spanning selection,
upload intent, durable application record, delivery URL, and revocation. The
current residual is tracked in
[finish the media happy path](../issues/20260815-finish-media-happy-path.md).
The lower-level asset lifecycle should remain available, but “one avatar,”
“several post images,” and “one post video” must not each require a new
backend-specific representation trick.

#### R4. Supply policy-aware protected history

Clique's removed-member rule exposes a real semantic gap: the server should
stop new delivery immediately while a device may retain already-authorized
history. Explicit could enforce the first half but needed an application-owned
encrypted transcript cache for the second. LLP 0243 should produce or
explicitly decline a first-party protected-read profile with authorization
invalidation, user-switch wipe, expiry, and view-once exclusion. This is not a
Familiar shortcut; it is a general capability whose policy should be visible
and configurable in Explicit and safely presettable in Familiar.

#### R5. Add an ordinary presence/typing convenience over canonical ephemeral state

Snapback's ephemeral primitive was consistently better aligned with typing
than durable control rows, but each app still rebuilt memoized args, activity
timers, idle withdrawal, unmount withdrawal, and wording. Provide a small
generated/client convenience for “active after local activity; withdraw after
idle or lifecycle end,” using the canonical publish/withdraw protocol and
retaining the explicit primitive underneath. It must meet the benchmark's
visibility and disappearance bounds without making typing durable application
data.

#### R6. Make the benchmark distinguish app, platform, and instrument truth

The final status must combine product acceptance and frozen choreography;
neither may silently stand in for the other. Preflight should reject missing
provider credentials before the clock starts. The common replay should include
real media selection, semantic receipt transitions, membership removal,
protected-history behavior, and process-restart session custody. Every red must
identify whether the application, Snapback/runtime, provider/setup, or harness
failed. This improves the product because it prevents instrumentation defects
from steering API design.

#### R7. Make group authority declarative, and treat it as differentiation

The sweep's deepest cross-cutting seam was authority expressiveness for
group-shaped data. It recurred across the
[Familiar](../diaries/0079-clique-0121-snapback-familiar.diary.md) and
[Simplified](../diaries/0081-clique-0121-snapback-simplified.diary.md) lanes;
Simplified stays outside the improvement agenda above, but its authority
evidence concerns the shared semantic core rather than the Simplified surface,
so it counts here. Three seams composed:

1. **No declarative membership/role rule.** Computed member access is not
   available as a declared rule, so every conversation, membership, message,
   and receipt handler performs its own active-member or admin check. This is
   the still-open residual.
2. **No sanctioned cross-owner read for an authenticated server handler.**
   Owner visibility filtered `ctx.db` reads inside explicit named functions,
   and the Simplified lane's forced workaround migrated conversation,
   membership, and message backing rows to public-read visibility — the
   sweep's largest authority compromise. The landed
   [scoped elevated-read correction](../issues/closed/20260815-owner-visibility-filters-handler-reads-membership-authority-gap.md)
   supplies the bounded path, pending external revalidation.
3. **Principal validators rejected inside structured arrays**, hit in both
   the receipt/member schema case and recipient snapshots, forcing
   server-authored string IDs instead of principal objects. The landed
   [schema expressiveness correction](../issues/closed/20260815-familiar-schema-expressiveness-refusals.md)
   covers the lowering, pending rerun.

The controls sharpen the opportunity: no evaluated backend supplied a
declarative answer at group scope. Convex expresses membership checks as
function code by design
([Convex](../diaries/0085-clique-0121-convex.diary.md)); InstantDB's builder
judged the rule surface "not a comfortable place to express
active-member/admin checks" and moved authority into a Node adapter
([InstantDB](../diaries/0084-clique-0121-instantdb.diary.md)); PocketBase's
diary concedes that "the declarative rule layer alone is not a complete
group-messaging authorization language"
([PocketBase](../diaries/0082-clique-0121-pocketbase.diary.md)); and the
Supabase control aborted before its RLS could be judged. A declarative
group-authority capability is therefore differentiation work, not parity
work. LLP 0240's accepted application authority profile is exactly this
design; the residual is to implement it far enough that the ordinary group
pattern — member/admin authorization, bounded elevated reads, removal,
negative delivery checks, and retained-history policy — composes without
copying the same guard into every handler, which is the decisive Familiar
test below and the same requirement in the Explicit agenda.

### Familiar-specific agenda

Familiar should optimize recognition and closure, not merely character count:

1. Keep the ordinary core deliberately small. When an app crosses its edge,
   expose either an exact first-class Familiar name over the canonical semantic
   model or a stable refusal that points to the supported route. Never make
   data encoding or an untyped Explicit escape hatch the path of least
   resistance.
2. Generate useful JSDoc and remediation at the call site for query delivery,
   authority, assets, and presence. A familiar-looking function whose lifecycle
   contract is discoverable only in a guide is not yet familiar.
3. Make groups the decisive ordinary-pattern test: typed principal snapshots,
   member/admin authorization, bounded elevated reads, removal, negative
   delivery checks, and retained-history policy should compose without copying
   the same guard into every handler.
4. Keep codegen, client admission, Metro exports, and runtime loading under one
   profile/name grammar. Source-level aliases are worthwhile only when the
   generated and operational surfaces honor them end to end.
5. Complete LLP 0252's external npm Phase 3 evaluation and stop rule. If the
   paired rerun still shows no closure or time advantage after shared seams are
   fixed, merge or tier the surface rather than preserving a second vocabulary
   by inertia.

### Explicit-specific agenda

Explicit already succeeds as the reviewable power lane. Do not shorten its
schema, authority, lifecycle, or proof declarations merely to compete on source
brevity. Improve it by removing accidental integration ceremony:

1. offer the same first-party Expo/password auth bootstrap while preserving
   access to explicit authority transitions;
2. guarantee hot generation convergence and honest authorized-lease
   negotiation without restarts or retained-query surprises;
3. make protected local history a declared policy rather than bespoke app
   storage; and
4. keep exact references, membership snapshots, ephemeral channels, artifact
   identity, and verification receipts visible to the builder and reviewer.

The desired distinction is therefore not “easy versus complicated.” Familiar
is the narrow ordinary doorway; Explicit is the full control and audit surface.
They should share runtime semantics, lifecycle behavior, diagnostics, and
proof.

### Recommended sequence and evaluation gates

1. Publish and qualify the already-landed directory, name, lowering,
   descriptor, binding, auth, video-intent, and membership corrections; replay
   each original failure from a clean external consumer.
2. Land the media collection/command happy path and one first-party
   auth/bootstrap composition with web and native custody profiles.
3. Land or explicitly decline protected history, implement LLP 0240's
   declared authority profile far enough to retire per-handler membership
   guards, then add the bounded typing/presence convenience.
4. Expand the common Clique acceptance/choreography instrument and run the
   paired Explicit/Familiar evaluation required by LLP 0252.

The rerun should use one published release, a clean machine, provider preflight,
at least three successful builders per profile, and a second model family. Its
ordinary-path acceptance contract should prohibit package-source reading,
generated-directory copies or symlinks, manual supervisor restart, data-URL
media, and duplicated per-handler membership guards where the product now
offers the declared authority path. It should additionally prove:

- native session custody across a process restart;
- the existing 32-client auth-churn stress case;
- presence visible within two seconds and absent within five seconds;
- a removed member can read authorized old history but receives no new
  messages; and
- run-level receipts distinguish application, platform, provider/setup, and
  instrument outcomes.

This evidence would justify a Familiar promotion decision; the present diaries
do not. They do justify focusing future investment on Familiar plus the shared
Snapback journey, while retaining Explicit as the power lane and spending no
additional improvement effort on Simplified.

## Open questions

1. Which residual 0.1.21 findings replicate after Opus and Grok credentials are
   restored? Diary 0078 gives two-model confidence in older closure seams, but
   not in the current package's corrections or remaining effect size.
2. Does the first-class password program remove the broker tax for an external
   npm consumer, or merely move the remaining failures from storage core to
   activation and operations?
3. Which explicit declarations create useful review evidence, and which are
   redundant restatements that codegen could infer and present for confirmation?
4. Can a restricted portable handler environment support safe module/helper
   composition without weakening byte identity or deterministic execution?
5. What is the smallest React protected-cache profile that preserves
   authorization invalidation, user-switch wipe, expiry, and view-once
   exclusion?
6. Which current-main closures materially change builder experience under a
   fresh pinned npm run? Only a rerun can retire an observed friction from the
   product narrative.
7. Should the supervised client directly own the first-party password/auth
   coordinator, or should the product generate one endorsed composition from
   independently replaceable provider and client pieces?
8. Does the ordinary typing convenience belong in each React arm, or can one
   generated cross-client activity contract preserve consistent withdrawal
   semantics for React, Expo, Swift, and headless consumers?
9. Once LLP 0240's declared authority profile is implemented, does the
   ordinary group pattern actually retire per-handler membership guards under
   the external rerun, and does it hold as a competitive differentiator given
   that no 0.1.21 control supplied a declarative group-membership
   authorization language?

## Hand-off

No new umbrella implementation plan. Route findings through existing owners:
LLP 0208 for the Clique pilot gap program, LLP 0151 and the password-auth
program for P1/P5, LLP 0108/0118 for P2, LLP 0210/0220 for P3, LLP 0218/0219
and LLP 0155/0221 for P4/P8, LLP 0056/0100/0172 for P6, LLP 0131 for P7,
LLP 0122/0123 for P9/P13, LLP 0080/0120 for P10, LLP 0193/0178 for P11,
LLP 0061 for P12, and LLP 0189/0201 for P14 and publication posture. The
post-snapshot residuals route through LLP 0245–0249 as stated above; this does
not create a second umbrella plan. The 0.1.21 follow-up additionally routes
Familiar profile choices through LLP 0252/0253, client/auth lifecycle through
LLP 0238/0247, declared group authority through LLP 0240, semantic generation
through LLP 0241, protected history through
LLP 0243, media through its existing asset owners and open issue, guide
retrieval through LLP 0061, and paired measurement through LLP 0201. This
Research document owns the synthesis and rerun questions, not those
implementations.
