# LLP 0119: Reactive-by-default and live search

**Type:** Research
**Status:** Review
**Systems:** Competitive evaluation, Developer experience, Live Queries, Search, Client integration, Code generation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0073, LLP 0074, LLP 0112, LLP 0114, LLP 0115, LLP 0116, Diary 0022, Diary 0028, Diary 0030, Diary 0034, Diary 0037, Diary 0039

## Summary

Every bakeoff since Diary 0022 has recorded the same Convex advantage, and
the 2026-07-30 rerun (Diary 0039) named it Convex's deepest structural one:
an ordinary Convex query — including an indexed search query — is a reactive
subscription with no separate classification. One declared function covers
initial read, WebSocket push, reconnect, and authorization-dependent
invalidation as one feature. Snapback deliberately splits that surface: live
queries are an explicit authored subset (`defineLiveQuery` vs.
`defineQuery`), subscription attempts against ordinary queries refuse with
`SNAPBACK_FUNCTION_NOT_LIVE`, and portable search v1 is non-live four
separate ways, so the Pantry arm's clients must re-issue a fresh search
after every mutation.

This document collects the evidence on both sides, explains why Snapback's
boundary exists (an evidence choice under LLP 0074, not an omission), and
lays out the option space — from erasing the classification, through
auto-classification, client-side polish (the LLP 0112/0114 trajectory), two
shapes of live search, and hybrid freshness contracts. It makes no final
call; decision authority is LLP 0115 CV-11 and the owning documents named at
the end.

## What Convex does

**Diary-recorded evidence.** The strongest single observation is Diary 0028's
Convex calibration arm, under "What felt good": "Reactive queries were the
standout. One indexed query covered initial read, native WebSocket push,
reconnect, and authorization-dependent invalidation" — the same arm's
revocation tests confirmed the invalidation half directly. Diary 0022 ranked
Convex first for "best authoring and reactive client loop"; Diary 0034
(Campfire rerun) recorded that "ordinary queries become reactive without a
separate live classification"; and Diary 0037 (Pantry rerun)
recorded the search half — Convex's second client received WebSocket delivery
of a newly indexed recipe, because "Convex search queries participate in its
reactive query subscription model" while "Snapback portable search v1 is
ordinary request/response only." Diary 0039 condenses all of this into its
"Reactive-by-default data and search" heading.

**General Convex background** (general knowledge, not diary evidence, and
subject to LLP 0074's re-verify-before-reliance rule). Convex queries are
deterministic functions executed inside Convex's runtime against a consistent
snapshot of the database, and the system records each execution's read set
automatically. Mutations are serializable transactions; on commit, the
subscription layer intersects the committed write set with recorded read
sets, re-executes exactly the affected queries, and pushes fresh results over
the WebSocket. The same mechanism backs function-level result caching, and a
client's active subscriptions stay mutually consistent at one logical
timestamp. Search participates because a search-index query is still an
ordinary deterministic query — its read set covers the index range it
consulted, so an index-touching write invalidates and re-runs it like any
other read.

Three structural costs of that design are recorded alongside the praise,
because Snapback's comparison should not price them at zero. First,
determinism and runtime capture: reactivity-by-default requires every query
to be a deterministic function inside the provider's runtime, with reads
mediated so the read set can be recorded — Diary 0022: "Convex's
best-in-class coherence also means accepting its integrated runtime and
deployment model." Second, everything reactive is durable: Convex has no
ephemeral lane, so presence and typing became durable heartbeat rows with
app-authored expiry (Diaries 0022, 0028, 0039 §4); Cursor Garden — Snapback's
one decisive rerun win — is the same coin as the explicit classification.
Third, the reactive cache is online-only: Diary 0028 recorded that active
query results lived in JavaScript memory and did not survive a cold offline
boot.

## What Snapback does today

**The classification.** Snapback functions carry an explicit kind —
`FunctionKind { Query, Mutation, LiveQuery, Action }` in `src/manifest.rs` —
and the authoring surface exposes the split directly: `defineQuery`,
`defineLiveQuery`, and `defineJsLiveQuery` in
`packages/snapback-codegen/define.d.ts`. Subscription admission enforces it
at runtime: `live_subscribe` in `src/local.rs` refuses any function whose
kind is not `LiveQuery` with the stable `SNAPBACK_FUNCTION_NOT_LIVE`
diagnostic. The Pantry rerun proved that refusal deliberately as one of its
acceptance checks (Diary 0037, check 6).

**The live machinery behind the subset.** For functions that are classified
live, the invalidation machinery is real and reasonably precise.
`src/live_matcher.rs` captures read dependencies from executed query plans
(auth facts, point rows, and predicate-described range reads), proves
disjointness to skip wakes, and computes exact row deltas where honesty
permits (`compute_live_delta`) — falling back to a conservative
full-resnapshot `Replace` for ordered/limited windows and membership-gated
queries, where a changed-row set alone cannot resolve the new window. JS
(Ibex) live queries ride captured dependencies plus a table-granular read-set
summary. Relational, bounded-children, and — notably — search query plans
already have conservative table-granular arms in the affected-subscription
matcher, even though search functions cannot currently be subscribed at all.

Authorization invalidation is a separate obligation channel (LLP 0053; the
obligation/resolution machinery lives in `src/local.rs`): when
authority-relevant state changes, the protected sink is quarantined and a
fresh authorized snapshot resolves the obligation. Diary 0030 observed the
felt cost of the conservative version: "Protected JS live queries were
conservatively noisy. Each ordinary wall write produced a quarantine-to-empty
delivery followed by a fresh authorized snapshot — safe, but potentially
flickery and expensive for bursty surfaces."

**Why the boundary exists.** LLP 0074's Differentiate list names the
rationale — "authorization, invalidation, receipts, ambiguity, and
settlement are named facts rather than client conventions" — and its Refuse
list pins the inverse: "polling fallback must not be reported as proven
push." In this frame a live query is a per-function capability claim with
delivery, invalidation, reconnect, and authorization semantics that
acceptance evidence must back on every claiming target, while an ordinary
`Query` claims nothing beyond request/response, retains no server
subscription state, and runs against targets with no live evidence at all.
The classification keeps liveness claims honest per function rather than
asserted globally.

**Search v1's honest non-live posture.** LLP 0073 excludes live search four
separate ways: the generated function is `FunctionKind::Query`, not
`LiveQuery`; subscription attempts refuse with `SNAPBACK_FUNCTION_NOT_LIVE`;
live subscriptions sit in the Non-goals list; and the implementation-state
section records live/offline search as explicit nonclaims that "must earn
independent capability ids or the exact v1 target corpus before
advertisement." Its 2026-07-30 revision reaffirms the refusal as pinned
contract. The Pantry arm proves a synchronously maintained index (accepted
rows are searchable at their commit head — freshness is not the gap), then
proves that observing a change requires a fresh ordinary `client.search`
(Diary 0037, check 7). LLP 0115 CV-11 records that no reactive design exists
in 0073 — a genuine design hole, not deferred implementation.

**The 0112/0114 half.** LLP 0114 ships the first-class React surface
(provider, `useSnapbackQuery`, groups, mutation/optimistic settlement,
presence, connection) over the existing headless owners, and LLP 0112 turns
each finite `defineRoutes` entry into a generated query-group reference
booted through one LLP 0090 register-mode bundle: all children adopt at one
durable commit cut, with fail-closed fallback and visible recovery reasons.
Together they close the subscription-glue and typed-consumption half of the
gap Diary 0022 recorded ("The React adapter required manual aggregation of
four subscriptions, cleanup, and normalization"). They deliberately do not
touch the classification: LLP 0112 admits only routes whose children are all
`LiveQuery` — one ordinary `Query` child loses register-group generation
entirely — and search stays outside the live surface completely.

## How they differ, and why agents preferred Convex

The honest core of the difference is decision count and mental surface. A
Convex author writes a query; reactivity, caching, reconnect, and
auth-invalidation come with it. A Snapback author decides per function
whether it is `Query` or `LiveQuery` (search has no live option at all),
decides route composition under 0112's all-live eligibility rule, and reads
refusal diagnostics when the classification and the client's expectations
disagree. Every rerun scored this against Snapback where reactivity was
central: Campfire ("Convex keeps a small developer-experience lead" — Diary
0039 §3) and Pantry ("Convex remains better for this product shape because
its indexed search composes with the ordinary reactive query model" — Diary
0039 §6).

Recorded friction beyond the headline:

- **Non-live search in practice.** Pantry's post-mutation flow is
  poll-shaped: mutate, then re-issue the search. Workable for type-ahead and
  dashboards; visibly worse than push for a collaborative list.
- **Quarantine-to-empty flicker.** Diary 0030's protected live queries
  blanked and re-snapshotted on ordinary writes. Safe by construction, but a
  UI cost Convex never shows: its invalidation pushes one consistent new
  result rather than an empty intermediate.
- **Register-group cliff.** Adding one ordinary `Query` child to an
  otherwise-live route silently forfeits single-commit registered boot (LLP
  0112) — the newest surface reinforces the boundary rather than softening
  it, which LLP 0115's watch item calls out explicitly.

And the honest other side, which the same diaries record:

- **Boot consistency is arguably better than Convex's default.** The 0112
  registered bundle gives every child of a route the same durable commit cut
  with an inspectable receipt and a fail-closed fallback that never
  fabricates a cut. Diary 0022: "Compared with Convex, this is a more
  explicit route/boot protocol and a little more pre-mount ceremony; the
  payoff is inspectable single-commit provenance and a fail-closed fallback
  boundary." (Caveat: Convex's client also keeps cross-subscription
  consistency at a logical timestamp; the advantage claimed is the
  inspectable evidence and explicit fallback semantics, not consistency
  Convex lacks.)
- **The ordinary query stays free.** Non-live queries retain no server
  subscription state and make no delivery claims, so they run identically on
  targets with no live evidence.
- **The ephemeral lane exists.** Cursor-rate presence never touches durable
  storage; Convex's reactive-durable monoculture is what forced its
  heartbeat-row workaround.

## Option space

The options are not mutually exclusive; several compose. This document ranks
nothing and decides nothing.

### Option 1 — Make every query live (erase the classification)

Every `Query` (host-plan, JS, relational, search) becomes subscribable;
`FunctionKind::LiveQuery` disappears or becomes an implementation detail.

*Benefits.* Erases the decision and the register-group cliff in one move and
matches Convex's mental model exactly; the matcher already has conservative
arms for every host-plan shape, so a maximally coarse version is closer than
it sounds.

*Costs and risks.* This is the largest claim expansion available. Liveness
would stop being a per-function fact backed by targeted acceptance and become
a universal property every current and future query feature must uphold or
block on — every new plan shape ships with invalidation evidence, and every
target claims push or the universal claim is false (LLP 0074's Refuse list:
polling must not be reported as proven push; hosted targets have no live
evidence today). It also erases the free ordinary query: every read
potentially retains server subscription state, and conservative wake storms
plus quarantine flicker generalize to the whole query surface. The diaries
score the boundary's cost as real but modest, while its evidence value is
load-bearing in Snapback's two clearest wins. Erasing the classification
needs a replacement account of what a liveness claim means, or it silently
becomes "whatever the implementation does" — the exact failure mode LLP 0074
refuses.

### Option 2 — Auto-classify liveness, with explicit nonclaims and opt-out

Codegen infers live capability where the machinery can honestly support it
(host-plan queries; JS queries whose captured-read vocabulary the matcher
covers) and marks the rest — search until CV-11 lands, actions always — with
explicit generated nonclaims. Authors may opt out (`live: false`) but never
opt in past the inference.

*Benefits.* Removes most of the authoring decision while keeping claims
per-function and honest; the capability/manifest surface already carries
per-function facts, so the inference lands in existing carriers; the
register-group cliff softens because eligibility derives from capability
rather than authored kind.

*Costs and risks.* The boundary stops being an authored contract and becomes
an emergent property of plan shape: a small handler edit could silently flip
a function from live-capable to not, breaking subscribed clients at a
distance. That drift hazard needs a named mitigation (a refusal or loud
diagnostic when regeneration downgrades a previously live function, manifest
pinning, or both). Inference also sits near — though not across — LLP 0108's
no-inference-from-source invariants: classifying from the closed generated
plan is static and reviewable, unlike inferring behavior from handler source,
but the distinction must be argued explicitly.

### Option 3 — Keep the boundary; erase the DX cost at the client (0112/0114)

Continue the current trajectory: first-class hooks, generated groups,
registered single-commit boot, optimistic settlement — and measure.

*Benefits.* Already specified and largely shipped; zero evidence-model
change; it demonstrably closed Diary 0022's concrete frictions. The rerun
checkpoint in LLP 0115 §Sequencing item 5 already requires at least one arm
to consume the 0114 React surface and a 0112 registered group, which will
produce the first measurement of how much of the felt gap was glue.

*Costs and risks.* It may not move the score. Diary 0039's matrix drove
headless clients, so the 0112/0114 gains were structurally invisible to it —
but the diaries' complaints are also substantially server-side (authoring
explicitness, search non-liveness, the classification itself), which this
option deliberately leaves untouched. If the post-CV-11, React-measured
rerun still scores the boundary as a loss, the watch item triggers and the
classification question reopens with data. Known residuals this option does
not address: the mixed-route register cliff and quarantine flicker.

### Option 4 — Live search by coarse re-execution on invalidation

Give `defineSearchQuery` a live-capable path: a subscribed search re-executes
when any commit touches its index's source table, and the subscriber receives
a full `Replace` page. The matcher in `src/live_matcher.rs` already contains
exactly this table-granular test for `HandlerPlan::SearchQuery`; search
execution is already bounded, deterministic, and authorization-rechecked per
page (`src/search/sqlite.rs`); the rank/highlight/cursor contract is
unchanged.

*Benefits.* Mostly composition, not new invalidation science: subscription
lifecycle, the conservative Replace lane, LLP 0053 auth obligations, and the
bounded search executor all exist. It delivers precisely what Pantry wanted —
the post-mutation result pushed instead of re-requested. Posting keys embed
the visibility partition, so wakes could later skip commits provably outside
the subscriber's partition.

*Costs and risks.* Write amplification is the core cost: every mutation on
an indexed table re-runs every subscribed search on that index — bounded per
query by the existing work ceilings but multiplied by subscriber count, and
type-ahead naturally creates many distinct subscribed queries per user; so
admission needs per-index live-subscription and concurrency budgets (0073's
request-path ceilings are a template). Cursor semantics need a decision:
stateless 120-second cursors do not compose with a long-lived subscription,
so the plausible v1 is first-page-only liveness with explicit non-live
continuation pages. Per LLP 0073's pinned gate, this ships only under its
own capability id with an eviction/invalidation evidence story — the CV-11
exit criterion verbatim — and `full_text_search_v1` itself stays non-live.

### Option 5 — Live search by incremental index-driven push

Compute affected subscriptions from posting deltas: the synchronous
maintenance path already computes the exact union of old/new posting keys per
mutation, so intersect changed posting keys (and partitions) with subscribed
queries' positive anchors and wake only genuine candidates.

*Benefits.* Precise wakes; re-execution cost scales with relevance rather
than table write rate; the strongest possible answer for hot indexes with
many subscribers.

*Costs and risks.* Materially harder, and it does not remove re-execution:
scoring is global per query — a changed posting proves a candidate changed,
not what the new top page is — so an affected wake still re-runs the bounded
page, and the per-page authorization release recheck runs per delivery
regardless. True incremental top-k maintenance is a research-grade engine
well beyond v1. Honestly read, option 5 is a wake-precision refinement
layered on option 4's delivery model, sequenced (if ever) after option 4
proves the subscription contract.

### Option 6 — Hybrid freshness contracts

Keep search (and other non-live reads) request/response, but give clients a
declared, honest freshness protocol instead of blind re-issue: a cheap
generated invalidation hint (for example, a live query over the index's
table-version or generation counter) that a client hook consumes to re-run
the ordinary search; optionally, declared staleness bounds surfaced as
explicit refresh receipts in the result envelope.

*Benefits.* Tiny server cost; no new claims on search itself — the result
remains request/response and says so; composes naturally with 0114 (a
`useSnapbackSearch` hook owning debounce, superseded-token discard, and
re-issue would erase most of Pantry's felt client friction); and the refresh
is visible, which fits the evidence model.

*Costs and risks.* Two round trips per change instead of one push; a new
hint-channel contract someone must own; and a real labeling hazard —
LLP 0073 pins "no simulated reactivity, no capability drift," so this must
be presented as client convenience over an ordinary query, never as live
search. Marketed carelessly, it becomes exactly the relabeling 0073 forbids.

### Sub-question — quarantine-to-empty smoothing

Diary 0030's flicker deserves its own treatment because the obvious fix is
wrong. Holding prior rows visible while a fresh snapshot is in flight would
soften real revocations — the blank is the fail-closed proof that revoked
data stopped flowing, and LLP 0053's obligation model depends on it. The
better frame is wake precision, not delivery smoothing: an ordinary write
that provably cannot change authorization inputs (policy tables, owner
fields, membership rows) should not trigger the authorization quarantine at
all — it should ride the ordinary data-delta/resnapshot lane, which never
blanks. That is a narrower conservative predicate in the matcher and
obligation issuer, preserving quarantine-to-empty exactly where an
authorization-relevant change occurred. A client-side residual (0114 stores
exposing "stale, refresh in flight" on the non-authorization lane) is
cosmetic by comparison and must never apply to the revocation path.

## Findings

1. The advantage is real, consistent, and structural. Four independent
   diaries across two bakeoff generations (0022, 0028, 0034/0037, 0039)
   recorded the same one-declaration-covers-everything observation in almost
   the same words; this is not a single agent's taste.
2. Snapback's boundary is a deliberate evidence choice, documented before
   the rerun scored it. LLP 0074 names invalidation and settlement as facts
   and refuses reported push that is not proven push; LLP 0073 pins search
   non-liveness four ways and reaffirmed the pin on 2026-07-30. Any change
   must answer that rationale, not just the DX complaint.
3. The subscription-glue half of the gap is closed or closing. LLP 0114/0112
   replaced Diary 0022's hand-aggregation with generated groups and
   single-commit registered boot — and no matrix measurement of those gains
   exists yet, because the rerun method drove headless clients.
4. Most of what coarse live search (option 4) needs already exists: the
   matcher's table-granular `SearchQuery` arm, the Replace delivery lane,
   the auth-obligation machinery, and a bounded per-page-rechecked executor.
   The genuinely new work — admission budgets, the cursor/liveness decision,
   a capability id, the evidence story — is composition, not invention.
5. Fine-grained index-driven push (option 5) is not an independent near-term
   path. It refines option 4's wake precision and still re-executes pages;
   treating it as the v1 target would stall the practical win.
6. Erasing the classification (option 1) endangers three load-bearing
   properties at once: per-function honest claims, the zero-cost ordinary
   query, and the durable/ephemeral lane contrast behind the Cursor Garden
   win. It is the only option requiring a new theory of what liveness claims
   mean.
7. Quarantine flicker is a wake-precision problem, not a delivery-smoothing
   problem. Smoothing the revocation path would weaken the fail-closed
   property; narrowing which writes count as authorization-relevant would
   remove most flicker without touching it.
8. Register-mode boot consistency is a genuine advantage with inspectable
   receipts, but the all-`LiveQuery` eligibility rule turns one ordinary
   child into a cliff. The cliff looks independently softenable (mixed-route
   groups registering live children and read-bundling the rest); no recorded
   reason it must be a cliff rather than a gradient was found.
9. Convex's model has costs the diaries recorded but the scoring rarely
   prices: runtime capture and determinism requirements, durable-only
   reactive state (heartbeat presence), and an online-only cache.
10. Whatever path is chosen for search, LLP 0073's gate stands: a live path
    ships under its own capability id with its own evidence, or a dated
    decision records why non-live remains the claim.

## Confidence

High: every diary-attributed claim above was read from the cited diary during
this research, and the code claims (`FunctionKind` in `src/manifest.rs`, the
`SNAPBACK_FUNCTION_NOT_LIVE` refusal in `src/local.rs`, the matcher arms and
`compute_live_delta` lanes in `src/live_matcher.rs`, the authoring split in
`packages/snapback-codegen/define.d.ts`) were spot-checked against current
main on 2026-07-30.

Medium: the general Convex background (read-set recording, re-execution on
write-set intersection, logical-timestamp client consistency). It matches
the diaries' observed behavior but was not re-verified against current Convex
documentation here; LLP 0074's inventory rule applies to anyone relying on
it.

Low-to-medium: the cost estimates in options 4 and 5 (amplification,
admission budgets, type-ahead subscription counts). No prototype exists;
these are structural arguments, not measurements.

## Open questions

1. For live search v1 (option 4): first-page-only liveness with non-live
   continuation pages, or a redesigned cursor that composes with
   subscriptions? The 120-second stateless cursor does not answer this.
2. What is the capability id and maturity path for live search — a sibling
   of `full_text_search_v1` gated on the same target evidence, or a
   composition of the live-query and search capabilities?
3. Is option 2's drift hazard (silent live-to-non-live downgrades under
   regeneration) acceptable with a refuse-on-downgrade diagnostic, or does
   it disqualify inference outright?
4. Who owns option 6's invalidation-hint contract if it proceeds — LLP 0073,
   LLP 0114, or a small new Spec?
5. Does the quarantine wake-precision refinement belong to LLP 0053 or to
   the matcher's conservative predicate — and can authorization-relevance be
   derived from declared schema facts alone?
6. Should the mixed-route register cliff (LLP 0112) be softened
   independently of any classification decision, and does that need a 0112
   amendment or a v2 profile?

## Relationship to LLP 0115 and owning documents

LLP 0115 CV-11 owns the live-search decision: design in LLP 0073's frame,
composing with the LLP 0112/0114 surfaces rather than inventing a parallel
channel, with the exit "either a shipped live-search path under its own
capability id … or a dated LLP 0073 decision recording why non-live remains
the claim." The classification itself is LLP 0115's "Reactive-by-default
queries" watch item — no action now, revisited only if the next rerun,
measured through the React surface, still scores the boundary itself as a
loss after CV-11 and the query-group surface ship. Options 1 and 2 above are
therefore inputs to a future watch-item trigger, not proposals; options 3
through 6 and the quarantine sub-question map onto work LLP 0115 already
sequences or the owners can absorb: LLP 0073 (portable search, the non-live
pin, any live-search capability), LLP 0112/0114 (generated groups, registered
boot, React consumption), LLP 0053 (authorization invalidation and
quarantine), LLP 0034 (live transport), and LLP 0074 (the strategic evidence
frame). Substantive design lands in those documents, not here.

This document is part of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search (this document) |
| 0120 | relational-composition-and-aggregation |
| 0121 | transactional-one-off-scheduling |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges |
| 0124 | product-breadth-storage-and-vector-search |
| 0125 | concurrency-and-conflict-ergonomics |
