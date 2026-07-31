# LLP 0136: Live search by coarse re-execution

**Type:** Spec
**Status:** Draft
**Systems:** Search, Live Queries, Client integration, Code generation, Auth,
Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:**
**Related:** LLP 0034, LLP 0037, LLP 0039, LLP 0053, LLP 0065, LLP 0073,
LLP 0074, LLP 0090, LLP 0091, LLP 0112, LLP 0114, LLP 0115, LLP 0119,
LLP 0127, LLP 0130

## Summary

This Spec designs a live path for portable full-text search by coarse
re-execution on invalidation — LLP 0119 option 4, adopted as the design
direction by LLP 0115 CV-11 (v0.5) and LLP 0127 move 4. A subscribed search
re-executes its bounded first page whenever a commit touches its index's
source table; the subscriber receives a freshly authorized full page over
the existing live replace lane. The path ships under its own capability id,
`live_full_text_search_v1`, with the same rank/highlight/cursor contract as
non-live search; `full_text_search_v1` stays non-live, and its
`SNAPBACK_FUNCTION_NOT_LIVE` refusal remains pinned contract (LLP 0073).

Option 4's hypothesis — that the remaining work is composition rather than
new invalidation machinery — is assessed seam by seam below and
substantially holds: every load-bearing mechanism exists (matcher arm,
replace lane, bounded per-page-rechecked executor, LLP 0053 admission).
What remains is admission/dispatch seams, one additive wire member, an
authoring entry point, budgets, and evidence — no new invalidation science.

This is the CV-11 design half only: it decides the admission path and the
liveness scope and produces the cursor-semantics (LLP 0119 OQ1) and
capability-id (OQ2) proposals for the author. It ships no code and changes
no claim; implementation follows the author's acceptance.

## Scope and claim posture

Out of scope, per the commissioning ticket and LLP 0127: option 5's
posting-delta wake precision (a later refinement of this same delivery
model); the mixed-route register-cliff softening (LLP 0119 OQ6); quarantine
flicker (LLP 0053's diagnosis lane); any function-classification change
(the option 1a pre-registration stays watch-gated per LLP 0115); hosted,
PostgreSQL, and offline targets beyond their own evidence.

Claim posture until acceptance: nothing changes. Ordinary search functions
remain `FunctionKind::Query` and refuse subscription with
`SNAPBACK_FUNCTION_NOT_LIVE`; LLP 0073's four-way non-live pin stands
unedited. Appendix A drafts the dated LLP 0073 amendment to be applied
only when acceptance evidence lands — not before.

## Admission path (decision)

**Decision: SearchQuery-under-LiveQuery admission.** Live search is a new
authored function whose manifest entry pairs `FunctionKind::LiveQuery` with
the existing `HandlerPlan::SearchQuery(SearchQueryPlanV1)` runtime. No new
`FunctionKind` variant and no new `HandlerPlan` variant are minted.
Rationale: the kind vocabulary `{Query, Mutation, LiveQuery, Action}` is a
public closed carrier consumed by sync-class labels, retainability rules,
and the wire (`src/manifest.rs`); a fifth kind would ripple through every
kind match for zero semantic gain — a live search function *is* a live
query with a search plan. The manifest already holds both precedents
(`RelationalQuery` admits under `Query | LiveQuery`,
`BoundedChildrenQuery` under `LiveQuery` only); search follows the
relational shape. Keeping the authored classification untouched neither
anticipates nor forecloses the watch-gated option 1a.

LLP 0119's integration-blockers inventory, addressed blocker by blocker:

1. **Manifest admission** — `src/manifest.rs` admits `SearchQuery` plans
   only under `FunctionKind::Query`; other pairings fail as
   `SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH`. Change: add the
   `(LiveQuery, SearchQuery)` arm, validating with the same
   `validate_search_query_plan_shape`; its implied required capabilities
   are `full_text_search_v1`, `live_subscriptions`, and
   `live_full_text_search_v1` (mirroring the relational-under-LiveQuery
   precedent).
2. **Subscription admission** — `subscribe_live_prepared_with_invalidation`
   in `src/local.rs` requires `FunctionKind::LiveQuery`. That check needs
   no change: the live search function admits, and the ordinary search
   function keeps refusing with `SNAPBACK_FUNCTION_NOT_LIVE` — LLP 0073's
   pin preserved verbatim on exactly the functions it covers. One
   addition: an input guard refusing a non-null `after` member with the
   stable diagnostic `SNAPBACK_SEARCH_LIVE_CURSOR_UNSUPPORTED`, mirroring
   `SNAPBACK_BOUNDED_CHILDREN_LIVE_CURSOR_UNSUPPORTED` (the house
   first-page-only precedent).
3. **Execution dispatch** — search executes only through the
   `(Query, SearchQuery)` arm. Change: add a `(LiveQuery, SearchQuery)`
   arm delegating to the same executor path — same pinned snapshot, same
   server-resolved authority, same cursor authority, same page assembly.
   The pushed page is the page the request path would have produced at
   that commit head.
4. **The unreachable matcher arm** — `src/live_matcher.rs` already tests
   `HandlerPlan::SearchQuery(plan)` table-granularly
   (`change.table == plan.table`) but no valid subscription can reach it.
   With blockers 1–3 resolved the arm becomes reachable unchanged; it is
   the v1 wake predicate.
5. **The missing posting-key carrier** — `ChangedRow` in `src/storage.rs`
   carries table/id/op/row/changed-fields and no posting keys, so
   partition- or token-scoped wake precision is impossible without a new
   transaction-to-notification artifact. For option 4 this is no delivery
   blocker; it is why v1's wake-precision claim is pinned at exactly
   table-granular. The carrier is option 5's work, not built here.

## Authoring surface

`defineLiveSearchQuery({ table, index })` joins `defineSearchQuery` in the
codegen surface. It generates a distinct function (its own name and
identity) with `FunctionKind::LiveQuery` over the same `SearchQueryPlanV1`
carrier, arguments `{ query: SearchQueryAstV1, limit?: 1..50 }` (`after`
refused per blocker 2), and the same `SearchItemV1` row projection. An
application may declare both operations over one index. The generated
reference is an ordinary live-query reference with the search page Result
phantom, so the LLP 0114 hook admits it without a new reference class.

## Invalidation and delivery

**Wake.** The v1 wake predicate is the existing matcher arm: any commit
containing a `ChangedRow` whose table equals the index's source table
wakes every live-search subscription on that index — including commits
entirely inside other owners' visibility partitions (blocker 5). One
honest narrowing is admissible without a new carrier: when every relevant
`ChangedRow` carries a known nonempty `changed_fields` set disjoint from
the index's text, filter, stored, highlight, and visibility fields, the
commit provably cannot alter any posting, stored projection, partition,
or released field, and the wake may be skipped; unknown or empty
`changed_fields` always wakes. The narrowing is optional in v1 and
requires its own acceptance case if claimed.

**Coalescing.** Per subscription, at most one re-execution is in flight;
commits arriving meanwhile set a dirty flag and one trailing re-execution
runs against the latest commit head. Intermediate heads may produce no
delivery; deliveries are monotone in commit order and the final delivered
page always reflects the final head (no lost wake).

**Delivery.** Re-execution runs the unmodified bounded search executor —
same analyzer, scorer, tie-break, highlights, work ceilings, and per-row
authorization release recheck as the request path — inside one pinned
read snapshot. The result is delivered as a full page on the existing
conservative replace lane (`live_replace`); live search never uses the
`live_delta` lane. Search pages are ordered, limited windows — precisely
the shape `compute_live_delta` already declines — so the replace lane is
the honest carrier, not a fallback.

**Wire.** The establishment snapshot rides the existing
`LiveSubscribeOutput.snapshot: QueryOutput`, whose `{version, rows,
cursor}` shape already carries the continuation cursor. The replace
envelope (`LiveEnvelope::LiveReplace`) has no cursor slot; it gains one
ignorable optional `cursor` member — the optional-`resume` precedent
(LLP 0091 §0B.2: old decoders drop unknown optional additions) — set only
on live-search deliveries: a fresh continuation cursor when a safe one
exists, absent otherwise. This is the design's one wire change.

## Liveness scope and cursors (LLP 0119 OQ1 proposal)

**Decision: first-page-only liveness.** The subscription's live claim
covers exactly the first page (declared `limit`, at most 50). Continuation
pages are explicitly non-live: the client pages by ordinary non-live
search invocation using the cursor from the most recent delivered page.
The stateless 120-second `SearchCursorV1` contract is unchanged — no
redesigned subscription cursor, no server-retained cursor state.

This composes where the 120-second cursor alone does not because the
cursor is never asked to outlive its TTL or survive replacements: each
delivered page mints a fresh current-state cursor, and a held cursor from
a superseded page resumes under LLP 0073's existing keyset honesty or
fails closed with `SNAPBACK_SEARCH_CURSOR_RESTART`. "Same cursor
contract" is literal. Deep-pagination liveness would need per-subscriber
retained window state or multi-page re-execution per wake — rejected for
v1 as cost without demonstrated demand (Pantry's felt gap is the first
page). The bounded-children precedent establishes this scope shape.

## Authorization composition (LLP 0053)

Search results are protected reads; the live path must satisfy LLP 0053
without weakening LLP 0073's release discipline.

**Declared dependence.** Search visibility is a closed declared shape:
`public-read` (constant partition) or LLP 0065 `owner.v1` (one declared
owner field as partition and release authority). A live search function's
authorization dependence is therefore fully expressed in declarable form,
and its read summary is complete by construction (one source table plus
generated derived postings). LLP 0053's retainability invariant —
retainable ⇒ declared authorization dependence ⇒ enumerated events — is
satisfiable in principle for this shape.

**Retainability, honestly.** V1 nevertheless claims none of it. Live
search subscriptions are retention- and resume-ineligible: no RQS resume
tokens are minted, and reconnect always produces a fresh authorized page.
This needs no new enforcement — `rqs_eligible_digest_kind`
(`src/manifest.rs`) already returns `None` for any runtime that is not a
plain `HandlerPlan::Query`. The declared-dependence precondition for a
future retention profile holds, but retention stays a nonclaim until that
profile earns its own evidence (offline/retained search is already an
LLP 0073 nonclaim).

**Auth-scoped admission.** An `owner.v1` live search in sessions mode is
auth-scoped and rides the existing admission gates unchanged: the
negotiated auth-invalidation protocol and a stable authorization
namespace are required, exactly as for other auth-scoped live queries. A
`public-read` live search carries the generated `authorityIndependent`
fact (the validator's admitted shapes extend to the `public-read` search
plan), so it admits without the protocol.

**Why every delivery is safe.** Ownership transfer, deletion, and content
change are ordinary source-table writes: they rewrite postings
synchronously in the same transaction (LLP 0073) and wake the
table-granular matcher. Every delivery — establishment and every replace —
is a full re-execution under the subscriber's *current* resolved authority
with LLP 0073's per-row release recheck; no retained payload is ever
re-published. Shrinkage is delivered honestly as a smaller fresh page,
never suppressed — the fenced-replacement shape LLP 0053's obligation
model demands is what this path does on every wake. LLP 0073's resolved
position that LLP 0053's global epoch is not asked to witness ordinary
owner-row changes carries over: correctness comes from re-execution plus
release recheck, not epoch advancement. Authority-lifecycle changes
(session end, LLP 0039 transitions) use the existing client-wide
disposition rules; live search adds no new lane.

**Noninterference.** LLP 0073's paired-database observation boundary
extends to the push path: paired databases differing only in an
unauthorized matching row must be indistinguishable across wake
occurrence, delivery timing class, delivered rows, decoded cursor
plaintext and encoded length, and termination codes. The table-granular
wake fires identically on hidden-partition commits in both databases and
re-executed pages release nothing unauthorized, so coarse wakes open no
existence channel — the acceptance suite proves this, not assumes it.

## Lifecycle: eviction and refresh

- **Unsubscribe, connection close, and expiry** ride the existing live
  subscription lifecycle unchanged. **Admission over budget refuses; the
  server never silently evicts** a subscription to admit another.
- **Re-execution refusal fails the subscription closed.** If a wake's
  re-execution cannot release a page — work-ceiling overflow, index
  unavailable, corruption — the subscription terminates on the live
  channel with the request path's stable diagnostic
  (`SNAPBACK_SEARCH_WORK_LIMIT`, `SNAPBACK_SEARCH_INDEX_UNAVAILABLE`,
  `SNAPBACK_SEARCH_INDEX_CORRUPT`). A delivered page is never re-asserted
  as current after a failed refresh; the client re-subscribes and
  observes the coded refusal on establishment.
- **Physical generation activation** (same semantic version) needs no
  subscription event: the next wake re-executes against the active
  generation; delivered cursors follow the existing activation restart
  rule. **Semantic version change, reset, and restore/stream-epoch
  change** terminate live-search subscriptions with the coded restart,
  riding the invalidation identities the cursor rules already bind.

## Budgets and wake amplification

Write amplification is the design's central cost: one commit on an
indexed table re-runs every subscribed search on that index. The bounds:

- **Per-wake cost** — the declaration's existing logical work ceiling,
  unchanged from the request path.
- **Per-commit fanout** — the subscription ceilings below times one
  coalesced re-execution per subscription; coalescing bounds burst cost
  by executor throughput rather than commit rate.
- **Per-index ceiling** — a declared `maxLiveSubscriptions` per index per
  target, default 64 (LLP 0073's per-index request-path admission
  ceilings are the template).
- **Per-connection ceiling** — default 8 per connection per index,
  bounding type-ahead churn: a keystroke that subscribes must first
  release a predecessor or be refused.
- Admission past either ceiling refuses with the stable diagnostic
  `SNAPBACK_SEARCH_LIVE_SUBSCRIPTION_LIMIT` before any storage work.

Ceilings live in the search declaration's limits family, version-bound
like the other limits; the defaults are this Spec's proposal, finalized
at implementation against the measurement gates.

## Client composition (LLP 0112 / LLP 0114)

The live search reference is an ordinary generated live-query reference:
`useSnapbackQuery` subscribes it through the provider like any live
query, and replace deliveries update the store. The client adapter
derives the page shape the same way `client.search()` does — `items` from
rows, `hasMore = cursor != null` — using the envelope's cursor member.
Type-ahead ergonomics (debounce, superseded-token discard, handoff under
the per-connection ceiling) are a candidate `useSnapbackSearch` hook
owned by LLP 0114 if it proceeds; this Spec requires only that the plain
hook path works.

LLP 0112 register groups are untouched: a live-search child's `query`
argument is a per-interaction structured AST, which route-static register
groups cannot carry under LLP 0112's existing literal/parameter rules —
register-ineligible today by 0112's own admission, no rule change.
Whether a search child should ever join a registered boot is deferred to
the LLP 0119 OQ6 cliff work.

## Capability id and claim discipline (LLP 0119 OQ2 proposal)

**Decision: a sibling capability id, `live_full_text_search_v1`,** at
experimental maturity initially. A target may claim it only when it
already claims `full_text_search_v1` with the exact v1 semantic profile
and `live_subscriptions`, and has run this Spec's live acceptance on that
target. Composition alone never implies the claim: holding both parents
does not grant the sibling — the id asserts exactly what the live
acceptance proved, per LLP 0074's evidence discipline. Inspection reports
the id beside `FullTextSearchFactsV1` with the liveness scope
(first-page-only), wake granularity (table-granular), delivery lane
(replace-only), ceilings, and the retention/resume nonclaims as named
facts.

`full_text_search_v1` is unchanged: ordinary search functions stay
`Query`, keep refusing subscription with `SNAPBACK_FUNCTION_NOT_LIVE`,
and Diary 0037's check 6 stays green forever. LLP 0073's non-live pin is
amended only by the dated note in Appendix A, applied on acceptance.

## Acceptance

Falsifiable evidence a claiming target must retain:

1. **Pantry live.** On a claiming target, a client subscribed to the
   Pantry recipe search receives — without issuing any further request —
   a pushed first page containing a row newly inserted by a second
   client's committed mutation, and a pushed page omitting a row that
   mutation deleted or transferred away. The delivered page equals the
   page a fresh non-live search would return at the same commit head,
   byte-for-byte (rank, highlights, stored fields, cursor semantics).
2. **Refusal matrix.** Ordinary search subscription still refuses
   `SNAPBACK_FUNCTION_NOT_LIVE`; live subscription with non-null `after`
   refuses `SNAPBACK_SEARCH_LIVE_CURSOR_UNSUPPORTED`; admission past
   either ceiling refuses `SNAPBACK_SEARCH_LIVE_SUBSCRIPTION_LIMIT`; a
   target lacking the capability refuses before storage work.
3. **Fail-closed refresh.** Injected work-limit overflow, index
   unavailability, and corruption during re-execution terminate the
   subscription with the coded diagnostic; no stale page is re-published.
4. **Authorization.** LLP 0073's paired-database noninterference corpus
   extended to the push path (wake occurrence, delivered rows, cursor
   plaintext/length, termination codes); an `owner.v1` transfer between
   deliveries releases no stale field or existence fact; auth-scoped
   admission requires the invalidation protocol and namespace exactly as
   other auth-scoped live queries.
5. **Coalescing.** A commit burst during an in-flight re-execution
   produces one trailing delivery reflecting the final head, with no
   lost wake and monotone delivery order.
6. **Lifecycle.** Generation activation, semantic migration, reset, and
   restore produce the specified events; delivered cursors behave
   identically to request-path cursors across replacement, expiry, and
   rotation.

**Measurement gates.** LLP 0119's named empirical questions (OQ7) become
preregistered measurements over a deterministic corpus, budgets recorded
before the run (LLP 0073's preregistration discipline): wake
amplification and fanout under write load (re-executions per commit at N
subscribers, proving the coalescing and ceiling bounds); first-page
re-execution cost versus the request path at the same head; type-ahead
churn (subscribe/release storms at the per-connection ceiling, measuring
admission overhead and cross-subscriber impact); end-to-end push latency
from mutation commit to client delivery; and cursor behavior across
replacements (page-2 fetches from superseded pushed pages, classified
against the keyset guarantees). A gate failure blocks the capability
claim on that target; the numbers also feed LLP 0115's rerun scoring so
the design's cost hypotheses are measured, not asserted.

## Non-goals

Delta delivery for search pages; posting-delta wake precision and any
`ChangedRow`/notification carrier change (option 5); continuation-page
liveness; retention, resume, or offline search; register-group membership
for search children; counts, facets, suggestions; relational/membership
visibility; any function-classification change (option 1a stays
watch-gated per LLP 0115); hosted, PostgreSQL, or accelerator targets
without their own evidence.

## Open questions

1. Does the `changed_fields` wake narrowing land in v1 or wait for its
   own acceptance case? (Default: wait.)
2. Final ceiling numbers after the measurement gates run.
3. Does `useSnapbackSearch` (debounce/handoff ergonomics) proceed in
   LLP 0114, and does its absence blunt the Pantry rerun score?
4. Do hosted targets claim the id in the same wave or after the local
   profile's gates run? (LLP 0073's staged-target discipline either way.)

## Appendix A — draft LLP 0073 amendment (apply only on acceptance)

To be added to LLP 0073's **Revised** header and §Implementation state
*only when* `live_full_text_search_v1` acceptance evidence lands on a
claiming target; nothing is edited before then:

> YYYY-MM-DD (live search under its own capability id, per LLP 0136 and
> LLP 0115 CV-11: a separately authored `defineLiveSearchQuery` operation
> pairs `FunctionKind::LiveQuery` with the unchanged `SearchQueryPlanV1`,
> re-executing the bounded first page on table-granular invalidation and
> delivering full authorized pages on the replace lane, first-page-only,
> under `live_full_text_search_v1` with its own acceptance evidence. The
> ordinary `defineSearchQuery` operation, its `FunctionKind::Query`
> classification, and its `SNAPBACK_FUNCTION_NOT_LIVE` refusal are
> unchanged; the non-live pin now scopes to that ordinary operation
> rather than to search as a feature. Delta delivery, wake precision
> beyond table granularity, continuation pages, and retention/resume/
> offline remain nonclaims under LLP 0136.)

LLP 0073's Non-goals list then drops "live search subscriptions" in favor
of a pointer to this Spec's claim boundary, and its implementation-state
nonclaims narrow from "live/offline search" to "offline search" plus this
Spec's residual nonclaims. CV-11's exit is satisfied on the shipped-path
fork at that moment, not before.
