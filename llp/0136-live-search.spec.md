# LLP 0136: Live search by coarse re-execution

**Type:** Spec
**Status:** Accepted
**Systems:** Search, Live Queries, Client integration, Code generation, Auth,
Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-08-02 (Appendices A/B folded into LLP 0073/0091/0094 as
staged accepted design contracts; implementation and capability evidence
remain pending); 2026-07-31 (ACCEPTED under LLP 0130 SD-4's standing
authorization: dual-family READY — Fable round 2, Codex round 3 —
with the three conditions checked and satisfied: (1) zero unresolved
MATERIAL concerns in either family's final round (Codex round 3
verified all four round-2 items resolved, no fresh defects; Fable's
round-2 notes N1–N6 were applied in v0.3); (2) within the decided
scope of its commission (move4's live-search design half per the
0127 synthesis and 0119's option space); (3) no evidence boundary
weakened — v1 scoped down honestly to non-auth-scoped subscriptions
with the auth-scoped lane refused at admission rather than claimed,
ceiling defaults held provisional behind measurement gates, and the
wire changes routed as dated LLP 0091/0094 amendments instead of
silent edits. Recorded per SD-4's honesty rule: the author's
standing acceptance made in advance. Review artifacts:
reviews/0136-live-search.{fable,codex}.md.);
2026-07-31 (v0.2 — round-1 dual-family fixes; verbatim
reviews in `reviews/0136-live-search.fable.md` and
`reviews/0136-live-search.codex.md`, both NOT READY (Fable C1–C10 plus
suggestions; Codex 1–8 plus suggestions), merged, verified against the
tree, none rejected. Two shape decisions: v1 scopes to non-auth-scoped
subscriptions — sessions-mode `owner.v1` refuses at admission, because
the auth-scoped lane's `AuthorizationInvalidationSnapshot` is a
`deny_unknown_fields` closed shape with no cursor slot, making its
extension versioned successor wire work (Codex 1) — and coalescing is
dropped from v1 for the engine's synchronous in-frame per-commit
delivery under hard ceilings (Fable C2, Codex 4). Also applied: wake
amplification restated table-wide across all indexes with a per-table
aggregate ceiling (Codex 2); refresh failure reconciled with the
shipped `resync_required` and obligation paths (Codex 3); literal-AST
search children excluded from `registerGroupEligible` by explicit
two-sided rule (Fable C1); the `authorityIndependent` validator seam
and `publicInline` foreclosure enumerated (Fable C3, Codex 6); the
`LiveReplace` cursor member specified as load-bearing behind a
negotiated connection declaration, routed in Appendix B (Codex 5,
Fable C8); ceiling defaults provisional behind the measurement gates
(Codex 7); the acceptance oracle repaired to LLP 0073's semantic
cursor comparison at a pinned head (Codex 8, Fable C4);
noninterference vocabulary aligned (Fable C5); `changed_fields`
narrowing excluded from the v1 claim with the L4 convergence
obligation named (Fable C6); facts/ceilings carriers pinned (Fable
C7); quiet-index TTL and capability-id custody stated (Fable C9–C10).);
2026-07-31 (v0.3 — round-2 fixes; verbatim round-2 sections in both
review artifacts: Fable READY (N1–N6, wording/routing edges only),
Codex NOT READY (three MATERIAL plus one moderate); all items applied,
none rejected. The `liveSearchProtocol` negotiation carrier is fully
specified: a capability-preflight-gated optional member of the closed
`OpenConnectionRequest` under LLP 0094's §0C.5 offer matrix, with the
old-target path never seeing the member, the skew refusal surfaces
named honestly, and the offer field's own LLP 0094 amendment routing in
Appendix B §B.1a (Codex 1, Fable N4). The client-side cursor
invalidation on refresh resync is bound as an atomic store obligation
with an acceptance case 3 row (Codex 2). The per-table aggregate
ceiling moves to a single table-level carrier (`TableManifest`) with
conflicting generation inputs refusing, and the per-commit arithmetic
is pinned sum-wise and extended to multi-table commits (Codex 3, Fable
N6). The sessions-mode refusal's precedence against the generic
auth-invalidation gates is pinned and case 2 conditioned like case 4
(Codex 4, Fable N3). Seam 6's keyed-surface sweep is completed with
`is_protected_query`, the route-layer live gate, the register-child
namespace matrix, and the mooted retention interplay (Fable N1); the
coalescing sentence is reconciled with case 5's per-commit pins (Fable
N2); §B.1's cursor-absence semantics are pinned to
terminal-page-only (Fable N5).)
**Related:** LLP 0008, LLP 0034, LLP 0037, LLP 0039, LLP 0051, LLP 0053,
LLP 0058, LLP 0065, LLP 0073, LLP 0074, LLP 0090, LLP 0091, LLP 0092,
LLP 0093, LLP 0094, LLP 0112, LLP 0114, LLP 0115, LLP 0119, LLP 0127,
LLP 0130

## Summary

This Spec designs a live path for portable full-text search by coarse
re-execution on invalidation — LLP 0119 option 4, adopted as the design
direction by LLP 0115 CV-11 (v0.5) and LLP 0127 move 4. A subscribed search
re-executes its bounded first page whenever a commit touches its index's
source table; the subscriber receives a freshly authorized full page over
the existing live replace lane. V1 scopes to subscriptions that are not
auth-scoped: sessions-mode `owner.v1` search is refused at admission
pending a successor (§Authorization composition). The path ships under
its own capability id, `live_full_text_search_v1`, with the same
rank/highlight/cursor contract as non-live search; `full_text_search_v1`
stays non-live, and its `SNAPBACK_FUNCTION_NOT_LIVE` refusal remains
pinned contract (LLP 0073).

Option 4's hypothesis — that the remaining work is composition rather than
new invalidation machinery — is assessed seam by seam below and
substantially holds *for the v1 scope*: every load-bearing delivery
mechanism exists (matcher arm, replace lane, bounded per-page-rechecked
executor). What remains is admission/dispatch seams, one load-bearing
wire member plus its capability-preflighted open-time declaration, the
`authorityIndependent` validator/codegen extension, an explicit
register-group exclusion, an authoring entry point, budgets, and
evidence — no new invalidation science. The boundary that keeps the
hypothesis honest is the scope itself: sessions-mode `owner.v1` search
is auth-scoped, its delivery lane is a closed snapshot shape with no
cursor slot, and extending that shape is real versioned wire work — so
v1 refuses it at admission and a successor owns it.

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
PostgreSQL, and offline targets beyond their own evidence. Two further
exclusions decided by this revision: sessions-mode auth-scoped live
search — the `AuthorizationInvalidationSnapshot` cursor extension is a
successor amendment (§Authorization composition, Appendix B §B.2) — and
the coalescing delivery executor, successor machinery for targets with
asynchronous fan-out (§Invalidation and delivery).

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
and the wire (`crates/snapback/src/manifest.rs`); a fifth kind would ripple through every
kind match for zero semantic gain — a live search function *is* a live
query with a search plan. The manifest already holds both precedents
(`RelationalQuery` admits under `Query | LiveQuery`,
`BoundedChildrenQuery` under `LiveQuery` only); search follows the
relational shape. Keeping the authored classification untouched neither
anticipates nor forecloses the watch-gated option 1a.

LLP 0119's integration-blockers inventory, addressed blocker by blocker:

1. **Manifest admission** — `crates/snapback/src/manifest.rs` admits `SearchQuery` plans
   only under `FunctionKind::Query`; other pairings fail as
   `SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH`. Change: add the
   `(LiveQuery, SearchQuery)` arm, validating with the same
   `validate_search_query_plan_shape`; its implied required capabilities
   are `full_text_search_v1`, `live_subscriptions`, and
   `live_full_text_search_v1` (mirroring the relational-under-LiveQuery
   precedent).
2. **Subscription admission** — `subscribe_live_prepared_with_invalidation`
   in `crates/snapback/src/local.rs` requires `FunctionKind::LiveQuery`. That check needs
   no change: the live search function admits, and the ordinary search
   function keeps refusing with `SNAPBACK_FUNCTION_NOT_LIVE` — LLP 0073's
   pin preserved verbatim on exactly the functions it covers. Two
   additions: an input guard refusing a non-null `after` member with the
   stable diagnostic `SNAPBACK_SEARCH_LIVE_CURSOR_UNSUPPORTED`, mirroring
   `SNAPBACK_BOUNDED_CHILDREN_LIVE_CURSOR_UNSUPPORTED` (the house
   first-page-only precedent); and the v1 auth-scope guard — a
   subscription that would be auth-scoped (sessions mode and not
   authority-independent, the predicate the subscribe path already
   computes) refuses with the stable diagnostic
   `SNAPBACK_SEARCH_LIVE_AUTH_SCOPED_UNSUPPORTED` before any storage
   work (§Authorization composition). The shared argument validation
   binds `limit: 1..50` at subscribe exactly as at request; the
   cursor-aware connection declaration also gates here (seam 8).
3. **Execution dispatch** — search executes only through the
   `(Query, SearchQuery)` arm. Change: add a `(LiveQuery, SearchQuery)`
   arm delegating to the same executor path — same pinned snapshot, same
   server-resolved authority, same cursor authority, same page assembly.
   The pushed page is the page the request path would have produced at
   that commit head.
4. **The unreachable matcher arm** — `crates/snapback/src/live_matcher.rs` already tests
   `HandlerPlan::SearchQuery(plan)` table-granularly
   (`change.table == plan.table`) but no valid subscription can reach it.
   With blockers 1–3 resolved the arm becomes reachable unchanged; it is
   the v1 wake predicate.
5. **The missing posting-key carrier** — `ChangedRow` in `crates/snapback/src/storage.rs`
   carries table/id/op/row/changed-fields and no posting keys, so
   partition- or token-scoped wake precision is impossible without a new
   transaction-to-notification artifact. For option 4 this is no delivery
   blocker; it is why v1's wake-precision claim is pinned at exactly
   table-granular. The carrier is option 5's work, not built here.

Round-1 review added three seams beyond LLP 0119's inventory (Fable C1
and C3; Codex 1, 5, and 6):

6. **The `authorityIndependent` validator and codegen** — today
   `validate_authority_independent` admits only plain
   `HandlerPlan::Query` runtimes; every other HostPlan refuses at load
   with `SNAPBACK_AUTHORITY_INDEPENDENT_INVALID` (`crates/snapback/src/manifest.rs`).
   Public-read live search therefore needs a new validator arm
   admitting a `SearchQuery` plan exactly when the index's declared
   visibility is `public-read` (constant partition, no authority or
   ambient input anywhere in the plan), plus codegen emission of the
   fact for `public-read` live-search declarations. Until this seam
   lands the failure mode is fail-closed: the function is treated
   auth-scoped and, in v1, refused in sessions mode. Sweeping every
   surface keyed on a valid `authorityIndependent` declaration:
   `rqs_eligible_digest_kind` stays `None` through its independent
   plan-shape gate, so the retention/resume nonclaim survives the
   extension; `publicInline` would become newly declarable on
   public-read search functions (`validate_public_inline` accepts it on
   any function with a valid `authorityIndependent` declaration), and
   v1 forecloses that — a search-plan function declaring `publicInline`
   refuses at load — until an inline-disclosure analysis earns it;
   `is_protected_query` (`crates/snapback/src/manifest.rs`) takes a valid-declaration
   public-read live search out of the default-deny protected execution
   profile — the treatment plain authority-independent live queries
   already get, intended by symmetry, and fail-safe until the seam
   lands (an undeclarable function stays protected); the sessions-mode
   route-layer live gate (`session_live_protocol_refusal`,
   `crates/snapback/src/server.rs`, LLP 0058) passes a valid-declaration public-read
   live search on any sessions target and, until the seam lands,
   refuses it fail-closed as auth-scoped (its precedence interaction
   with the search-scope refusal is pinned in §Authorization
   composition); the register-child authorization-namespace matrix
   (`crates/snapback/src/local.rs`) is unreachable for search children by seam 7's
   exclusion; and the retention-validation interplay is moot — search
   runtimes refuse retention through the plan-shape gate regardless of
   the flag.
7. **Register-group exclusion** — the `registerGroupEligible`
   derivation and its server-side routes validation test only that
   every child is a `LiveQuery` and every `$param`-mapped arg is
   string-typed (`packages/snapback-codegen/index.mjs`,
   `crates/snapback/src/local.rs`); a literal-AST live-search child would derive
   eligible the moment the pairing exists. V1 excludes it explicitly
   (§Client composition).
8. **The cursor-aware client declaration** — the `LiveReplace` cursor
   member is load-bearing result data, not an ignorable addition; its
   admission gate and wire routing are specified under §Invalidation
   and delivery (Wire) and drafted in Appendix B (§B.1 the cursor
   member, §B.1a the open-time offer field).

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

**Wake.** The v1 wake predicate is the existing matcher arm, and its
granularity is honestly table-wide: the matcher compares only
`change.table == plan.table` (`crates/snapback/src/live_matcher.rs`), so any commit
containing a `ChangedRow` on an indexed source table wakes every
live-search subscription on **every** search index over that table —
not merely the index whose postings changed — including commits
entirely inside other owners' visibility partitions (blocker 5).
Worst-case re-executions per commit are therefore the sum of live
subscriptions across all of the table's indexes, which is why §Budgets
bounds the aggregate per table, not only per index. One honest
narrowing is admissible without a new carrier: when every relevant
`ChangedRow` carries a known nonempty `changed_fields` set disjoint
from the union of every field the index declaration names in any role
(text, filter, stored, highlight, visibility — closed over future
declaration extensions by construction), the commit provably cannot
alter the delivered page or any released fact, and the wake may be
skipped; unknown or empty `changed_fields` always wakes. The narrowing
is **excluded from the v1 claim**. If later claimed it needs its own
acceptance case, a rerun of the noninterference corpus over wake
occurrence, and — because the disjointness set includes visibility
fields, making the skip an authorization-sensitive proof — the
LLP 0008 L4-style convergence assertion LLP 0053 requires: in test/dev
profiles every skip verdict is checked against a full re-execution.

**Delivery cadence (decision: synchronous, no v1 coalescing).** V1
delivery is the engine's shipped shape:
`notify_live_subscriptions_in_frame` re-executes every affected
subscription synchronously inside the commit's notification frame
(`crates/snapback/src/local.rs`). There is no per-subscription in-flight state, no
dirty flag, and no trailing-run scheduler, and v1 adds none: each
observed commit re-runs each affected subscription once, so per-commit
cost is exactly commit rate × affected subscriptions — bounded by
§Budgets' admission ceilings, not by an executor-throughput claim.
Deliveries are per-commit and monotone in commit order, and after the
last commit of any burst the last delivered page reflects that
commit's head — the falsifiable quiescence form of "no lost wake". A
coalescing executor (at most one in-flight re-execution per
subscription, a dirty set, one trailing run at the latest head) is
real new machinery with its own correctness obligations — no lost
wake, monotone delivery, teardown races, generation/authority fencing
of queued work, a concurrency ceiling, obligation-discharge
composition — and belongs to the first target that needs it (the
hosted/asynchronous fan-out lanes), as a successor with its own spec
text and acceptance. V1's acceptance does bind claiming targets to
per-commit delivery — case 5's no-lost-wake and monotonicity rows are
per-commit pins, so a coalescing target claims under the successor's
amended acceptance, never under v1's; nothing in v1's budget
arithmetic assumes coalescing.

**Delivery.** Re-execution runs the unmodified bounded search executor —
same analyzer, scorer, tie-break, highlights, work ceilings, and per-row
authorization release recheck as the request path — inside one pinned
read snapshot. For every v1-admitted subscription the result is
delivered as a full page on the existing conservative replace lane
(`live_replace`); live search never uses the `live_delta` lane. Search
pages are ordered, limited windows — precisely the shape
`compute_live_delta` already declines — so the replace lane is the
honest carrier, not a fallback. The fan-out has a second lane v1
deliberately never reaches: auth-scoped subscriptions branch into
`deliver_authorization_snapshot`, whose
`AuthorizationInvalidationSnapshot` frame carries only
subscription/function/version/rows and discards any cursor
(`crates/snapback/src/local.rs`, `crates/snapback/src/live_wire.rs`); the v1 admission refusal
(§Authorization composition) is what keeps "every delivery rides
`live_replace`" true rather than aspirational. Establishment inherits
the existing subscribe path's no-missed-commit ordering between the
establishment snapshot and matcher registration; the search path adds
no new window.

**Wire.** The establishment snapshot rides the existing
`LiveSubscribeOutput.snapshot: QueryOutput`, whose `{version, rows,
cursor}` shape already carries the continuation cursor. The replace
envelope (`LiveEnvelope::LiveReplace`) has no cursor slot; it gains one
optional `cursor` member, set only on live-search deliveries: a fresh
continuation cursor exactly when a safe continuation exists, absent
exactly when the delivered page is terminal (§B.1 pins the absence
semantics). The member is **load-bearing, not ignorable**: a decoder
that drops it cannot construct `{items, cursor, hasMore}` after a
replacement, so the LLP 0091 §0B.2 optional-`resume` precedent covers
only wire tolerance (old decoders do not break on the unknown member —
`LiveEnvelope` refuses nothing), never semantic ignorability.
Admission therefore gates on a negotiated client declaration, and that
declaration is the design's **second wire surface**, not a free rider:
`liveSearchProtocol` is a new optional member of the closed
(`deny_unknown_fields`) `OpenConnectionRequest` (`crates/snapback/src/server.rs`),
following the LLP 0094 §0C.5 offer matrix the DTO's existing offer
fields already obey — a known value (`1`) binds the connection lineage
(immutable across authenticated re-opens, the §0B.3 `wireVersion`
binding rule), an unknown value refuses the open with the stable
diagnostic `SNAPBACK_SEARCH_LIVE_PROTOCOL_UNSUPPORTED`, and an absent
member opens a legacy connection that can never hold a live-search
subscription — subscribe refuses with the stable diagnostic
`SNAPBACK_SEARCH_LIVE_CLIENT_UNSUPPORTED`. Client emission is
**capability-preflight-gated**, never unconditional: a generated
client emits the offer only when the target's advertised capability
set (the non-admin `/inspect` projection's
`capabilityManifest.supportedCapabilities`, the client kit's existing
preflight surface) includes `live_full_text_search_v1`, so the
old-target path never sees the member. The gate matters because the
open DTO is closed: an old server *binary* receiving the unknown
member refuses the entire open as a body decode failure
(`SNAPBACK_REQUEST_JSON_INVALID`), breaking unrelated durable use on
that connection — the preflight omission keeps that surface off the
ordinary path. Version skew is fail-closed on three named surfaces: an
old client never holds a live-search subscription (the subscribe
refusal above); a new *app* declaring the live operation against an
old target refuses at app load through the unknown-capability gate
(§Capability id) — the served-pairing prevention; and a new client
that skipped the preflight against an old binary refuses at open
through the closed DTO — coarser than a capability-scoped refusal,
still fail-closed. Ownership routes explicitly, one dated amendment
per owning document: the `cursor` member lands as an LLP 0091 §0B
amendment (drafted in Appendix B §B.1), re-proving old-decoder
tolerance where it is pinned — the regenerated wire schema exports and
the JS kit pin (`demos/_kit/tests/live-wire-schema.mjs`) under
LLP 0051's drift gates, plus LLP 0093's Swift-client fixtures
regenerated (its implementation clusters, LLP 0094–0096, absorb the
member on their surfaces); the offer field lands as a dated LLP 0094
amendment (drafted in Appendix B §B.1a) — LLP 0094 owns
`OpenConnectionRequest`'s schema, closure posture, and offer matrix
(its §0C.1 and §0C.5).

## Liveness scope and cursors (LLP 0119 OQ1 proposal)

**Decision: first-page-only liveness.** The subscription's live claim
covers exactly the first page (declared `limit`, at most 50). Continuation
pages are explicitly non-live: the client pages by ordinary non-live
search invocation using the cursor from the most recent delivered page.
The stateless 120-second `SearchCursorV1` contract is unchanged — no
redesigned subscription cursor, no server-retained cursor state.

This composes where the 120-second cursor alone does not because the
cursor is never asked to outlive its TTL while deliveries continue, nor
to survive replacements: each delivered non-terminal page mints a fresh
current-state cursor, and a held cursor from a superseded page resumes
under LLP 0073's existing keyset honesty or fails closed with
`SNAPBACK_SEARCH_CURSOR_RESTART`. On a quiet index — no commits, so no
re-minting delivery — a held cursor ages past its TTL exactly like a
request-path cursor and paging fails closed with the same coded
restart. "Same cursor contract" is literal. Deep-pagination liveness
would need per-subscriber retained window state or multi-page
re-execution per wake — rejected for v1 as cost without demonstrated
demand (Pantry's felt gap is the first page). The bounded-children
precedent establishes this scope shape.

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
(`crates/snapback/src/manifest.rs`) already returns `None` for any runtime that is not a
plain `HandlerPlan::Query`. The declared-dependence precondition for a
future retention profile holds, but retention stays a nonclaim until that
profile earns its own evidence (offline/retained search is already an
LLP 0073 nonclaim).

**Auth-scoped admission (decision: refused in v1).** An `owner.v1`
live search in sessions mode would be auth-scoped (the existing
predicate: sessions mode and not authority-independent). V1 refuses it
at subscription admission with the stable diagnostic
`SNAPBACK_SEARCH_LIVE_AUTH_SCOPED_UNSUPPORTED`, before any storage
work. Check order is pinned, not left to code placement: within
subscribe admission the auth-scope search guard runs *ahead of* the
generic auth-invalidation gates — the installation check
(`SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`), the protocol-declaration
checks (`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`), and the
namespace requirement (`crates/snapback/src/local.rs`) — so a sessions-mode
live-search subscribe that reaches admission always observes the
search-scope code; steering a client toward negotiating or installing
a protocol that cannot admit its subscription would be misleading. One
earlier layer stays generic: on a sessions-mode target whose
invalidation protocol is not ready, the route-layer live gate
(`session_live_protocol_refusal`, `crates/snapback/src/server.rs`, LLP 0058) refuses
all auth-scoped live work with
`SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` before admission is reached;
v1 leaves that fail-closed gate unchanged, so the search-scope code is
unconditionally observable exactly on targets with the invalidation
protocol installed — acceptance case 2 conditions its row accordingly,
mirroring case 4. Rationale: auth-scoped fan-out delivers
`AuthorizationInvalidationSnapshot`, a closed `deny_unknown_fields`
shape carrying only subscription/function/version/rows; the cursor a
live-search page needs has no slot there, and because the shape
refuses unknown members, adding one is a breaking wire change
requiring negotiation (a bump of the already-negotiated
auth-invalidation protocol version, or a successor snapshot kind) —
LLP 0091 §0B.2's ignorable-addition argument does not apply. That is
real versioned protocol work owned by a successor amendment (outlined
in Appendix B §B.2), not improvised here; refusing admission is
fail-closed and leaves LLP 0053's obligation boundary untouched — no
live-search subscription can carry a quarantine obligation in v1
because none is ever auth-scoped. The demand signal that commissioned
this design (Pantry's type-ahead, Diary 0037) is public-read and fully
inside the v1 scope. What v1 does admit: a `public-read` live search
carries the generated `authorityIndependent` fact once seam 6 lands
(§Admission path) and admits in every mode without the invalidation
protocol; an `owner.v1` live search outside sessions mode is not
auth-scoped and admits on the ordinary path, delivering on
`live_replace`. When the successor lands auth-scoped admission, its
refresh-failure semantics are bound now: they must ride the shipped
obligation machinery — bounded durable retry episodes,
`Quarantine`/`Delete` dispositions, exact-ACK discharge — never a bare
termination that drops an outstanding obligation.

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
occurrence; delivery occurrence, count, and order in the semantic
transcript; delivered rows; decoded cursor plaintext and encoded
length; and termination codes. That is LLP 0073's
value/code/continuation-shape vocabulary — deliberately not a timing
claim, which 0073 forbids asserting without separate evidence;
acceptance case 4 tests exactly this list. The table-granular wake
fires identically on hidden-partition commits in both databases and
re-executed pages release nothing unauthorized, so coarse wakes open no
existence channel — the acceptance suite proves this, not assumes it.

## Lifecycle: eviction and refresh

- **Unsubscribe, connection close, and expiry** ride the existing live
  subscription lifecycle unchanged. **Admission over budget refuses; the
  server never silently evicts** a subscription to admit another.
- **Re-execution refusal fails closed on the shipped failure path.** If
  a wake's re-execution cannot release a page — work-ceiling overflow,
  index unavailable, corruption — the existing fan-out failure path
  (`fail_subscription_fanout`, `crates/snapback/src/local.rs`) records the structured
  search diagnostic (`SNAPBACK_SEARCH_WORK_LIMIT`,
  `SNAPBACK_SEARCH_INDEX_UNAVAILABLE`,
  `SNAPBACK_SEARCH_INDEX_CORRUPT`) in the diagnostics ring and
  publishes `resync_required` with reason `live_refresh_failed` and
  `clear_retained: true` — the live envelope carries reason strings,
  not structured diagnostics, and this Spec does not change that. No
  page is published on a failed wake and no previously delivered page
  is re-asserted as current; the client's recovery is
  re-establishment, where a persistent cause reproduces the coded
  refusal on the request path. Every v1 subscription rides this
  public-path state machine because none is auth-scoped
  (§Authorization composition); the successor's auth-scoped failure
  semantics are bound there to the obligation-preserving
  retry/quarantine machinery.
- **Physical generation activation** (same semantic version) needs no
  subscription event: the next wake re-executes against the active
  generation; delivered cursors follow the existing activation restart
  rule. **Semantic version change, reset, and restore/stream-epoch
  change** terminate live-search subscriptions with the coded restart,
  riding the invalidation identities the cursor rules already bind.

## Budgets and wake amplification

Write amplification is the design's central cost, and its honest model
is table-wide: one commit on an indexed table synchronously re-runs
every live-search subscription on every index over that table
(§Invalidation and delivery). The bounds:

- **Per-wake cost** — the declaration's existing logical work ceiling,
  unchanged from the request path.
- **Per-commit total** — delivery is synchronous and per-commit, so
  worst-case re-executions per commit equal the live-search
  subscriptions admitted across all of the table's indexes. Because
  per-wake ceilings are per-declaration and may differ across a
  table's indexes, worst-case per-commit work is the **sum over
  admitted subscriptions of each one's own declared per-wake
  ceiling** — bounded above by the aggregate count times the maximum
  admitted per-wake ceiling across the table's indexes. The per-table
  aggregate ceiling below makes the count a hard bound — by admission,
  not by scheduling. A commit touching several indexed tables re-runs
  the union of those tables' admitted live-search subscriptions; its
  worst case is the sum over touched tables of each table's per-commit
  bound — still hard, by the same admission arithmetic.
- **Per-index ceiling** — a declared `maxLiveSubscriptions` per index
  per target, provisional default 64 (LLP 0073's per-index
  request-path admission ceilings are the template).
- **Per-table aggregate ceiling** — a target-enforced bound on
  live-search subscriptions summed across every index over one source
  table, provisional default 128, **declared at most once per table**
  on the single table-level carrier pinned in §Capability id; this is
  the count the per-commit arithmetic uses, so declaring more indexes
  never multiplies the admitted total past it.
- **Per-connection ceiling** — provisional default 8 per connection
  per index, bounding type-ahead churn: a keystroke that subscribes
  must first release a predecessor or be refused. Unsubscribe releases
  synchronously ahead of same-frame admission, so release-then-
  subscribe within one keystroke never trips the ceiling.
- Admission past any ceiling refuses with the stable diagnostic
  `SNAPBACK_SEARCH_LIVE_SUBSCRIPTION_LIMIT` before any storage work.

The numeric defaults (64 / 128 / 8) are **provisional behind the
measurement gates** — they are LLP 0119 OQ7 quantities, not measured
facts. Until the gates run, a claiming target reports its enforced
values as mandatory inspection facts (§Capability id) and the numbers
bind only that target; they become normative spec defaults only through
a dated amendment after the gates pass (LLP 0073's preregistration
discipline: gates validate a preregistered bound, they never
retroactively choose one). The ceiling *structure* — all three ceilings
existing and refusing at admission — is normative now. The per-index
and per-connection ceilings live in the search declaration's per-index
limits family; the per-table aggregate ceiling is a table-scoped fact
with exactly one carrier; both are version-bound like the other limits
and pinned in §Capability id.

## Client composition (LLP 0112 / LLP 0114)

The live search reference is an ordinary generated live-query reference:
`useSnapbackQuery` subscribes it through the provider like any live
query. Because the continuation cursor is part of the result, the
headless live handle's state is atomic `{rows, cursor, version}`:
establishment adopts all three from the subscribe snapshot, every
replace delivery adopts all three from the envelope in one step (a
delivery without a cursor member adopts `cursor: null`), and
re-establishment replaces all three — no state where rows and cursor
disagree is ever observable. One transition in between is a new
client obligation, not inherited behavior: on `resync_required` for a
live-search subscription — including `live_refresh_failed` with
`clear_retained: true` — the shipped kit clears only retained RQS
state and starts an asynchronous resubscribe
(`packages/snapback-client/index.mjs`), which would leave a superseded
page's cursor observable as current while re-establishment is in
flight. The live-search store must instead transition atomically at
the resync event, before any resubscribe is scheduled: `cursor: null`
and the page marked non-current in the same step — retained rows may
remain displayed as stale data, but `hasMore` derives false and no
continuation can be issued from the superseded page through the
store. Re-establishment then adopts fresh `{rows, cursor, version}`
atomically as above. Acceptance case 3 tests this transition. The
LLP 0114 store projects the search page the same way `client.search()`
does — `items` from rows, `hasMore = cursor != null` — so the hook
returns the same result contract as the one-shot path. Type-ahead
ergonomics (debounce, superseded-token
discard, handoff under the per-connection ceiling) are a candidate
`useSnapbackSearch` hook owned by LLP 0114 if it proceeds; this Spec
requires only that the plain hook path works.

Register groups get an explicit exclusion, not an inherited one. The
tree-true state: a `$param`-mapped `query` arg is ineligible today by
the string-typing rule, but `registerGroupEligible` is derived from
exactly two facts — every child a `LiveQuery`, every `$param`-mapped
arg string-typed (`packages/snapback-codegen/index.mjs`) — and
`assertLiteral` admits arbitrary object literals, so the moment the
`(LiveQuery, SearchQuery)` pairing exists, a route pinning a *literal*
search AST would derive eligible and enter the LLP 0090/0092
register-mode bundle boot unanalyzed. V1 therefore adds the rule this
Spec's v0.1 wrongly denied needing: the codegen derivation excludes
any child whose function carries a search plan, and the server-side
routes validation (`crates/snapback/src/local.rs`) refuses a `registerGroupEligible`
route containing one — fail-closed on both sides, with a test
asserting both refusals (seam 7, acceptance case 2). Whether a search
child should ever join a registered boot — bundle-cut dispatch,
ceiling admission on the register path, snapshot cursor handling — is
the LLP 0119 OQ6 cliff work, deferred with its analysis obligations
named rather than silently reachable.

## Capability id and claim discipline (LLP 0119 OQ2 proposal)

**Decision: a sibling capability id, `live_full_text_search_v1`,** at
experimental maturity initially. A target may claim it only when it
already claims `full_text_search_v1` with the exact v1 semantic profile
and `live_subscriptions`, and has run this Spec's live acceptance on that
target. Composition alone never implies the claim: holding both parents
does not grant the sibling — the id asserts exactly what the live
acceptance proved, per LLP 0074's evidence discipline. Inspection reports
the id beside `FullTextSearchFactsV1` with the liveness scope
(first-page-only), wake granularity (table-granular, across all indexes
on the source table), delivery lane (replace-only), enforced ceilings,
and the retention/resume and auth-scoped nonclaims as named facts.

Carriers are pinned, not gestured at. The inspection facts land as a
new closed sibling object, `LiveFullTextSearchFactsV1`, beside
`full_text_search` in the LLP 0037-owned inspection projection —
`FullTextSearchFactsV1` itself is closed and gains no members. The
ceilings split by scope onto two carriers, each with exactly one
authority. The per-index and per-connection ceilings land as a new
closed, optional member of the search declaration's limits family in
`SearchIndexManifestV1`. The per-table aggregate ceiling is a
table-scoped fact and gets a table-scoped carrier: a new closed,
optional `searchLiveLimits` member of `TableManifest` beside
`searchIndexes` (`crates/snapback/src/manifest.rs`), carrying
`maxLiveSubscriptionsPerTable` — declared at most once per table by
construction, so no two indexes can assert conflicting table
ceilings; the authoring surface accepts the value only at the table
level, and a generation input that attempts to set it per index, or
sets it inconsistently, refuses at generation rather than
reconciling. For both carriers: an absent member means the defaults;
unknown members keep refusing under the existing `deny_unknown_fields`
class; and the old-target posture is fail-closed on two honest
surfaces — an older *binary* refuses the manifest at decode (both
`TableManifest` and `SearchIndexManifestV1` are closed shapes), and a
binary that decodes the shape but does not claim the id refuses
through the existing unknown-capability class, because a manifest
declaring the live operation or its limits requires
`live_full_text_search_v1`. Either way the ceilings are never
silently dropped.
`live_full_text_search_v1` joins the closed `TargetCapabilityId`
vocabulary (`crates/snapback/src/manifest.rs`) like every claimable id. Custody after
acceptance, revising LLP 0127's what-lands-where line by one clause:
this Spec owns the live claim boundary and the
`live_full_text_search_v1` id; LLP 0073 owns the shared
rank/highlight/cursor contract that both operations bind.

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
   mutation deleted or transferred away. With the writer quiesced at
   that commit head, the delivered page equals a fresh non-live search
   at the same head byte-for-byte over rows, rank order, highlights,
   and stored fields; the cursor compares by LLP 0073's semantic
   oracle — decode class, decoded plaintext, encoded length — never by
   ciphertext bytes (equivalent cursors carry random nonces).
2. **Refusal matrix.** Ordinary search subscription still refuses
   `SNAPBACK_FUNCTION_NOT_LIVE`; live subscription with non-null
   `after` refuses `SNAPBACK_SEARCH_LIVE_CURSOR_UNSUPPORTED`;
   sessions-mode `owner.v1` live subscription refuses
   `SNAPBACK_SEARCH_LIVE_AUTH_SCOPED_UNSUPPORTED` ahead of every
   generic auth-invalidation admission check — on a target with the
   invalidation protocol installed, as case 4 already conditions; on a
   not-ready sessions target the route-layer gate answers
   `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` first, fail-closed either
   way (§Authorization composition); an open offering an unknown
   `liveSearchProtocol` value refuses
   `SNAPBACK_SEARCH_LIVE_PROTOCOL_UNSUPPORTED`; a connection without
   the cursor-aware declaration refuses
   `SNAPBACK_SEARCH_LIVE_CLIENT_UNSUPPORTED`; admission past any
   ceiling refuses `SNAPBACK_SEARCH_LIVE_SUBSCRIPTION_LIMIT`; a
   search-plan function declaring `publicInline` refuses at load; a
   `registerGroupEligible` route containing a search child refuses at
   build and at load; a target lacking the capability refuses before
   storage work.
3. **Fail-closed refresh.** Injected work-limit overflow, index
   unavailability, and corruption during re-execution publish no page,
   emit `resync_required` with reason `live_refresh_failed` and
   `clear_retained: true`, and record the structured coded diagnostic
   in the diagnostics ring; at the client, the resync transition
   atomically drops the live-search cursor (`cursor: null`, page
   non-current) before resubscription — no continuation is issuable
   from the superseded page through the store (§Client composition);
   re-establishment against a persistent cause reproduces the coded
   refusal on the request path; no stale page is re-published.
4. **Authorization.** LLP 0073's paired-database noninterference corpus
   extended to the push path over the semantic transcript (wake
   occurrence; delivery occurrence, count, and order; delivered rows;
   cursor plaintext and encoded length; termination codes — no timing
   claim); an `owner.v1` transfer between deliveries (non-sessions
   profile) releases no stale field or existence fact; the
   sessions-mode refusal of case 2 holds on a target with the
   invalidation protocol installed.
5. **Per-commit delivery.** A burst of N committed writes to the source
   table produces per-subscription deliveries monotone in commit
   order, and after the burst's last commit the last delivered page
   reflects that commit's head; no wake is lost (every affected commit
   produces its delivery). With two indexes over one table, one commit
   wakes the subscriptions of both indexes, and the per-table
   aggregate ceiling holds at admission.
6. **Lifecycle.** Generation activation, semantic migration, reset, and
   restore produce the specified events; delivered cursors behave
   identically to request-path cursors across replacement, expiry, and
   rotation.

**Measurement gates.** LLP 0119's named empirical questions (OQ7) become
preregistered measurements over a deterministic corpus, budgets recorded
before the run (LLP 0073's preregistration discipline): wake
amplification and fanout under write load (re-executions per commit at
N subscribers across one and several indexes over one table, plus a
commit touching two indexed tables, proving the synchronous per-commit
arithmetic and every ceiling, including the per-table aggregate —
worst case is the per-table sum of admitted per-wake ceilings, bounded
by aggregate ceiling × the maximum admitted per-wake ceiling, by
declaration, summed over touched tables); first-page re-execution cost
versus the request path at the same head; type-ahead churn
(subscribe/release
storms at the per-connection ceiling, measuring admission overhead and
cross-subscriber impact); end-to-end push latency from mutation commit
to client delivery; and cursor behavior across replacements (page-2
fetches from superseded pushed pages, classified against the keyset
guarantees). A gate failure blocks the capability claim on that
target; a gate pass is also what promotes the provisional ceiling
defaults to normative spec text via a dated amendment (§Budgets); the
numbers also feed LLP 0115's rerun scoring so the design's cost
hypotheses are measured, not asserted.

## Non-goals

Delta delivery for search pages; posting-delta wake precision and any
`ChangedRow`/notification carrier change (option 5); sessions-mode
auth-scoped live search and any `AuthorizationInvalidationSnapshot`
change (successor, Appendix B §B.2); the coalescing delivery executor
(successor for asynchronous fan-out targets); the `changed_fields` wake
narrowing as a claim; `publicInline` on search-plan functions;
continuation-page liveness; retention, resume, or offline search;
register-group membership for search children (explicitly excluded,
§Client composition); counts, facets, suggestions;
relational/membership visibility; any function-classification change
(option 1a stays watch-gated per LLP 0115); hosted, PostgreSQL, or
accelerator targets without their own evidence.

## Open questions

1. Does the `changed_fields` wake narrowing ever land, and in which
   release? (Decided for v1: excluded from the claim; its acceptance,
   noninterference-rerun, and L4-convergence obligations are named in
   §Invalidation and delivery.)
2. Final ceiling numbers after the measurement gates run (the 64/128/8
   defaults are provisional until then; §Budgets).
3. Does `useSnapbackSearch` (debounce/handoff ergonomics) proceed in
   LLP 0114, and does its absence blunt the Pantry rerun score?
4. Do hosted targets claim the id in the same wave or after the local
   profile's gates run? (LLP 0073's staged-target discipline either way.)
5. Which negotiation carrier does the auth-scoped successor use — an
   auth-invalidation protocol version bump or a successor snapshot
   kind? (Appendix B §B.2 outlines both.)

## Appendix A — LLP 0073 amendment (folded 2026-08-02)

The design amendment below was folded into LLP 0073 on 2026-08-02 without
claiming implementation. `live_full_text_search_v1` still cannot advertise on
a target until its complete acceptance evidence lands:

> YYYY-MM-DD (live search under its own capability id, per LLP 0136 and
> LLP 0115 CV-11: a separately authored `defineLiveSearchQuery` operation
> pairs `FunctionKind::LiveQuery` with the unchanged `SearchQueryPlanV1`,
> re-executing the bounded first page on table-granular invalidation and
> delivering full authorized pages on the replace lane, first-page-only
> and non-auth-scoped (sessions-mode `owner.v1` refuses at admission
> pending LLP 0136's successor), under `live_full_text_search_v1` with
> its own acceptance evidence. The ordinary `defineSearchQuery`
> operation, its `FunctionKind::Query` classification, and its
> `SNAPBACK_FUNCTION_NOT_LIVE` refusal are unchanged; the non-live pin
> now scopes to that ordinary operation rather than to search as a
> feature. Delta delivery, wake precision beyond table granularity,
> continuation pages, sessions-mode auth-scoped subscriptions, and
> retention/resume/offline remain nonclaims under LLP 0136.)

LLP 0073's Non-goals list then drops "live search subscriptions" in favor
of a pointer to this Spec's claim boundary, and its implementation-state
nonclaims narrow from "live/offline search" to "offline search" plus this
Spec's residual nonclaims. CV-11's exit is satisfied on the shipped-path
fork at that moment, not before.

## Appendix B — wire routing and the auth-scoped successor

The B.1/B.1a design contracts were folded into LLP 0091/0094 on 2026-08-02
as staged, explicitly unimplemented amendments. Their implementation
checklists below remain mandatory at the code landing.

**B.1 The replace-envelope cursor member (lands with
implementation).** A dated LLP 0091 §0B amendment adds one optional
member to `LiveEnvelope::LiveReplace`:

> `cursor` (optional string): a fresh search continuation cursor, set
> only on live-search deliveries. On a live-search delivery, absence
> means exactly "no continuation — the delivered page is terminal"
> (`QueryOutput.cursor`'s present-exactly-when contract is the model);
> a cursor-mint failure is a failed wake and routes to the fail-closed
> refresh path (`resync_required`), never a cursor-less delivery —
> the client derives `hasMore = cursor != null`, so any other absence
> would silently lie. Absent on every non-search delivery. Wire
> tolerance:
> old decoders drop the unknown optional member without error (§0B.2's
> decode rule, re-proven by the schema tests below). Semantic status:
> load-bearing, not ignorable — a subscriber that cannot decode it must
> not hold a live-search subscription, which admission enforces through
> the cursor-aware connection declaration
> (`SNAPBACK_SEARCH_LIVE_CLIENT_UNSUPPORTED`); the member's wire
> tolerance is never a substitute for that gate.

The amendment lands with: the regenerated wire schema exports and the
JS kit pin (`demos/_kit/tests/live-wire-schema.mjs`) under LLP 0051's
drift gates; LLP 0093's fixture corpus regenerated with cursor-carrying
and cursor-absent replace frames plus an old-decoder tolerance fixture;
and the LLP 0094–0096 implementation surfaces absorbing the member
where they render replace deliveries.

**B.1a The open-time offer field (lands with implementation).** A
dated LLP 0094 amendment — LLP 0094 owns `OpenConnectionRequest`'s
schema and closure posture (its §0C.1 row: the DTO stays closed, with
a staged member the sanctioned evolution path) and the open-time offer
matrix (its §0C.5) — adds `liveSearchProtocol` to the closed open DTO:

> `liveSearchProtocol` (optional integer): declares cursor-aware
> live-search decoding for the connection lineage. Known value (`1`)
> binds, immutable across authenticated re-opens (the §0B.3 lineage
> rule); an unknown value refuses the open
> (`SNAPBACK_SEARCH_LIVE_PROTOCOL_UNSUPPORTED`); absent opens a legacy
> lineage on which live-search subscribe refuses
> (`SNAPBACK_SEARCH_LIVE_CLIENT_UNSUPPORTED`). No response echo is
> added: under unknown-refuses, a successful offered open is itself
> the binding witness (the `authInvalidationProtocol` precedent).

The amendment lands with: the §0C.5 matrix row and §0C.1 row note; the
connection-record binding read at subscribe admission (the
connection-expectation check the auth-invalidation declaration already
models); the regenerated `connection.open.input.schema.json` under
LLP 0051's drift gates; the hosted arm's `kitOpenConnection` reading
the member — its open decoder otherwise silently feature-offs the
offer, LLP 0094's §0C hazard, live on this exact field; LLP 0093's
fixture corpus gaining offered, legacy, and unknown-value open
fixtures; and the generated-client emission rule — the capability
preflight against `live_full_text_search_v1` (§Invalidation and
delivery, Wire), so no open toward a target that does not advertise
the id ever carries the member.

**B.2 The auth-scoped successor (outline only; not v1 work).**
`AuthorizationInvalidationSnapshot` is `deny_unknown_fields`: a cursor
member there is a breaking decode change, not an ignorable addition.
The successor must choose a negotiated path — bump the
auth-invalidation protocol version the connection already negotiates
(old connections keep the old shape and remain refused for live
search), or mint a successor snapshot kind selected by the negotiated
version — and must carry: the atomic client adoption rule (`{rows,
cursor, version}` in one frame, obligation/resolution semantics
unchanged); the obligation-preserving refresh-failure semantics bound
in §Authorization composition (bounded durable retry episodes,
`Quarantine`/`Delete` dispositions, exact-ACK discharge — never a bare
termination); auth-snapshot cursor rotation and cursor clearing on
quarantine in its acceptance corpus; and its own fixtures. Until that
amendment is accepted, sessions-mode `owner.v1` live search remains
refused at admission with
`SNAPBACK_SEARCH_LIVE_AUTH_SCOPED_UNSUPPORTED`.
