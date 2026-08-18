# LLP 0067: Fate — lessons for Snapback and Contract

**Type:** Research
**Status:** Review
**Systems:** Live Queries, Sync, Realtime, Client integration, Contract/Exact, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-20
**Revised:** 2026-07-20 (round-9 revision after dual-model review: expanded F2a to the full three-direction failure taxonomy — the omitted visible-to-hidden membership revocation direction is the most security-sensitive face of the discrepancy — with revocation-preservation as an explicit prerequisite, and corrected the journal-reconstruction, non-live-sibling, transport-batching, and store-durability wordings)
**Related:** LLP 0000, LLP 0001, LLP 0005, LLP 0008, LLP 0012, LLP 0013, LLP 0020, LLP 0034, LLP 0035, LLP 0037, LLP 0043, LLP 0052, LLP 0053, LLP 0056, LLP 0066, Exact LLP 0179, Exact LLP 0216, Exact LLP 0263, https://fate.technology, https://github.com/nkzw-tech/fate

## Summary

Fate (fate.technology, Nakazawa Tech / Christoph Nakazawa, MIT; upstream
maturity claims conflict — see provenance) is a data client for React that applies Relay's core innovations —
co-located data requirements, view composition, normalized caching, data
masking — to type-safe TypeScript RPC, with no query language and no
Relay-style fragment compiler. It markets itself as "AI-Ready": "minimal,
predictable API and explicit data selection enable local reasoning" —
independently convergent with Snapback's agent-first thesis.

Fate is more directly relevant to Snapback than Effect (LLP 0066) because it
works the same seam: declared data dependencies flowing from UI components to
a typed backend, with realtime updates merged into a client cache — including
a server side that retains each connection's selections and intersects
changed fields with them. Three ideas are worth investigating, in descending
order of leverage:

1. **Field-level selection as a first-class declaration**, flowing from
   Contract views toward the server — hypothesized to reduce
   affected-subscription rate, payload bytes, and client update work on the
   live-query fallback path. The hypotheses are separable and must be
   benchmarked independently, and the investigation has two hard
   prerequisites surfaced by review: the membership/`live_delta` boundary
   discrepancy (F2a) and the selection-identity design fork (F2b).
2. **Field-level data masking in Contract** — enforce that a view can only
   read fields it declared, making declarations provably honest; the
   *enforcement* is standalone in value, while the *suppression economics*
   are a separate, larger change (F3).
3. **A normalized entity cache as an opt-in store experiment** — cross-query
   convergence for optimistic overlays; a maybe, only under explicit
   authorization-safety constraints and only after naming which client store
   layer it augments (F4).

## How to read this — provenance and confidence

Claims about Fate come from fate.technology (the views, requests, getting
started, and live-views guides), the `nkzw-tech/fate` README, and the Fate
1.0 announcement, read 2026-07-20; not verified against Fate's source, with
one narrow exception noted inline in F1 (a subscription-identity nuance
reported from the upstream `FateClient` client source during review — no
immutable revision pinned, so it is marked as such rather than treated as a
recoverable artifact).
Fate's own sources contradict each other on maturity: the README carries an
"alpha, not production ready" warning, while the official 1.0 announcement
(fate.technology/posts/fate-1.0, dated 2026-05-14) states "fate 1.0 is now
ready for production use" — both statements were live on the read date, so
treat maturity as unsettled and expect the model described here to move.
The monorepo ships separate packages (`@nkzw/fate`, `react-fate`); this
document deliberately does not pin or quote per-package version numbers —
successive registry reads during this document's review loop disagreed, so
none is load-bearing here. Claims about Snapback and
Contract cite the governing LLPs and code; the F2a discrepancy was
established by direct code inspection during this document's review loop
and is tagged `[confirmed]` at a pinned revision. All Fate-to-Snapback
influence and recommendation claims are `[inferred]`.

## Findings

### F1. Fate's model, precisely

Five distinct mechanisms, kept separate because they have different Snapback
counterparts:

- **Selection declaration.** A view declares the fields a component needs
  (`view<Post>()({ title: true, author: UserView })`). Selections may be
  written inline (`author: { id: true, name: true }`) or composed by
  referencing reusable views; the docs prefer composition by reference.
  Plain TypeScript objects with inference; no query language or fragment
  compiler; build tooling (a Vite plugin, CLI) wires transport and types,
  but there is no fragment-hoisting compilation step.
- **Request composition.** `useRequest` at a screen boundary takes an
  explicitly constructed request graph built from views; composition is
  authoring-level, and separately the native transport batches operations
  issued in the same microtask (multiple operations per render pass are
  documented) — together eliminating waterfalls for the views the author
  composed. The selected view participates in Fate's request cache key. It
  does not automatically discover arbitrary descendant components' views.
- **Connection multiplexing vs. logical subscriptions.** In Fate's native
  HTTP transport, each `FateClient` uses one SSE connection
  (`GET /fate/live`) with subscribe/unsubscribe control messages per view
  (other integrations may differ). Each live view is a logical
  subscription; the connection is transport multiplexing, not screen-level
  subscription composition. (Finer identity semantics — entity live views
  keyed by entity + selection plan and live-list views keyed by connection
  identity + arguments + selection plan, both reference-counted across
  identical consumers — were reported from the upstream `FateClient`
  client source during review, read 2026-07-20, no revision pinned; the
  public guides do not document them.)
- **Field-aware server invalidation.** The server keeps each connection's
  selections and "sends updates only for records that connection subscribed
  to"; publishers can pass a `changed` field list so each subscriber receives
  only relevant data. Fate ships native server machinery for this alongside
  tRPC/GraphQL integrations — it is not a client layered on generic RPC.
- **Masking and render suppression.** A component can only access fields its
  view declared, and re-renders only when a selected field changes, backed by
  a normalized cache (records keyed by type + id) with declarative optimistic
  updates and rollback.

### F2. What field selection could and could not buy Snapback

Snapback's live queries subscribe at the granularity of a named server query
(LLP 0008). The analyzable subset gets incremental `live_delta` (landed
2026-07-02); other shapes take the honest re-query + `live_replace`
fallback. Two numbers have historically framed the stakes — **~5–6 affected
fallback subscriptions per commit** (warm-VM, 2026-07-02; harness scope:
re-query, dependency capture, serialization, enqueue, timed outbox
draining) vs. **~28,000+** on the delta path (classification-plus-
serialization microbenchmark, no enqueue) — but both must now be read as
**invalid historical artifacts, not current measurements**: their fixtures
were subsequently corrected as methodologically unsound (commit `37f1a2f`,
ENG-23422/ENG-23423 — the old delta loop made only one subscriber match and
divided by the total count, which the corrected harness comment says
understated affected-delivery cost and overstated the derived ceiling; the
fallback fixture changed from an ever-growing result set to a fixed 16-row
one), and **no corrected full-scale rerun is recorded** in LLP 0035. They
are retained here only as historical motivation. The *mechanism* argument
survives (the delta path skips VM re-query entirely), and the corrected
smoke gate asserts per-run only that delta is decisively cheaper than the
protected re-query path — but the actual corrected ratio is **unmeasured**;
treat any magnitude as hypothesis, not evidence. Additionally, under the auth-era
measurement contract (LLP 0035, 2026-07-13), auth-scoped live queries take
a protected fresh-realm profile that has never been measured at full scale.
Any prototype must therefore remeasure **both paths** on the corrected
harness first, and report affected-subscription count separately from total
subscribers.

Against that baseline, a field-selected subscribe has three **independent**
hypothesized effects, each separately measurable:

1. **Affected-subscription rate.** A commit touching only unselected columns
   of a matching row need not invalidate the subscription — **but only for
   query classes with proven field lineage.** UI-delivery selection is not
   proof of server execution dependencies. Snapback *does* dynamically
   capture row/query read dependencies for Ibex handlers via `ctx.db` (the
   LLP 0020 Phase 3 substrate, one extractor shared by mutation isolation
   and the realtime matcher; `crates/snapback/src/runtime.rs` — the "no read-set
   extraction" framing in LLP 0008's Valet-era passage predates this), but
   capture is at row/range granularity: there is no *field-level
   source-to-output derivation lineage*, and an Ibex query may derive a
   selected output from an unselected column. Skipping the re-query from
   selection plus `changed_fields` is therefore sound only where the
   source-to-output field mapping is proven — direct `HostPlan` row
   projection, or a future declared dependency summary. Opaque queries stay conservative;
   post-execution selected-value equality may suppress *delivery* for them,
   which saves payload and client work but not the fallback server-compute
   ceiling. The commit pipeline already carries per-row `changed_fields`
   metadata — consumed today by the in-process live-query matcher (narrowly,
   to prove a non-matching update stayed non-matching against filter
   fields), by authorization-event classification, and by ephemeral
   invalidation, among other consumers; it is not journaled, so
   journal-reconstructed changed-row records (distinct from DK-9 offline
   mutation replay, which re-executes mutations through the normal path
   and produces ordinary metadata) carry empty
   changed-field sets and any field-aware suppression must degrade
   conservatively there (as the matcher already does) — so the
   proven-lineage arm of this
   hypothesis may need no new change-capture work.
2. **Payload bytes.** Fallback re-query results and delta payloads can be
   projected to selected fields. (Hidden cost to measure: when two
   subscriptions on one query declare different selections, payloads are
   rendered per-subscription or to the union.)
3. **Client update work.** Fewer dependent effect executions and host-update
   attempts downstream of an update — but see F3: masking alone does not buy
   this.

What field selection does **not** do, on the current engine, is widen
`live_delta` eligibility: eligibility is determined by query shape and
execution plan (`QueryPlan` carries filters, membership filters, ordering,
limit — no projection), and projection does not make an ordered window or an
Ibex-backed query incrementally analyzable. (Nuance: an *unordered* limited
query below its cap stays incremental today.) Fate demonstrates the
selection declaration, the field-aware server invalidation, and the masking;
it does **not** demonstrate screen-level *logical* subscription composition
(its live views stay per-view). Composing a screen's views into one
subscription is this document's own unverified proposal, to be weighed
against a simpler control attacking the same bottleneck: server-side shared
evaluation for identical query+args+authority watchers, which needs no new
authoring surface. `[inferred]`

#### F2a. Prerequisite: the membership/`live_delta` boundary discrepancy

Review of this document surfaced a design/implementation discrepancy that is
a safety prerequisite for any field-aware invalidation work. The governing
design (LLP 0056; LLP 0008) requires membership-gated (semi-join) queries to
ride the conservative re-query/`live_replace` lane — explicitly **not**
incremental deltas. As built, the delta path does not enforce that boundary:
delta candidacy admits any `HostPlan` single-table query with changes
(`crates/snapback/src/local.rs`, `try_live_delta_fanout` call sites), row classification
evaluates only ordinary `plan.filters` and never `plan.membership_filters`
(`crates/snapback/src/live_matcher.rs`, `row_matches_query_filters`), and the only
authorization guard on the delta path routes an auth-scoped subscription's
**Remove** ops back to the obligation-backed snapshot path (the as-built
realization of LLP 0053's rule that negative deltas are obligations —
0053 itself does not mandate fallback as the mechanism) — Add/Update ops
proceed without the membership predicate being evaluated. The affected live
surface is specifically **unordered, below-cap, membership-gated queries**
(ordered or at-cap shapes already bail to `Replace`); the Shindig demo
manifest contains at least one such query, so the shape is reachable.

The discrepancy has **three failure directions**, separately conditioned.
The membership-table-only mechanism is shared by the last two: such a
commit wakes the subscription (via the ordinary membership dependency that
LLP 0056's M3 landed — deliberately waking in *both* visibility
directions), but delta computation skips changes on other tables, yielding
zero ops — and empty ops settle as `NoChange`, which explicitly skips the
re-query. The `NoChange` return precedes the L4 convergence assertion's
only call site, so **debug builds miss it too** at the freezing delivery —
a *later* non-empty delivered delta may expose the drift to the assertion,
or may silently heal it; nothing guarantees detection.

- **Over-delivery** — a main-table row matching ordinary filters is
  classified into the result without the subscriber's membership predicate
  being checked. Independently real wherever the delta lane runs.
- **Hidden-to-visible freeze** — a membership insert or role upgrade that
  should reveal rows is swallowed; the subscriber never sees the newly
  visible rows.
- **Visible-to-hidden freeze (stale disclosure)** — a membership deletion,
  active-to-pending transition, or role downgrade that should *remove*
  rows is swallowed, leaving previously visible, now-forbidden rows frozen
  in the client. This is the most security-sensitive direction: it is
  stale authorization-sensitive disclosure, and no Remove op is ever
  generated for the delta path's auth guard to catch. Revocation
  preservation is therefore an explicit prerequisite for any selection
  work, and the filed issue's regression matrix must cover both membership
  visibility directions per auth mode.

Scope of the membership-direction freezes: with
  sessions-mode invalidation installed, membership writes classify as
  authorization events and auth-scoped subscriptions are resnapshotted
  *before* the delta loop (which excludes already-resynced ids), so this
  direction is preempted there; it remains reachable where no
  authorization-event resnapshot covers the subscription (e.g. dev-mode
  apps such as Shindig). The remaining follow-up is an end-to-end
  regression test for the membership-table-only transitions (both
  directions) per auth mode.

This is authorization-relevant runtime behavior. **Repaired 2026-07-21**,
alongside this revision: delta candidacy and `compute_live_delta` now fail
closed on non-empty `membership_filters` (belt-and-suspenders, with a unit
regression covering the main-table and membership-table-only shapes), and
the L4 debug convergence assertion also runs at `NoChange` settles, closing
the oracle blind spot recorded above (LLP 0008 DK-3 hardening note;
LLP 0056 §Delivery lanes). Any selection/invalidation prototype must still
treat
membership and authorization predicates as an explicit safety dependency:
selection may only ever *narrow* delivery, never substitute for the
membership/auth evaluation the conservative lane performs. `[confirmed
2026-07-20 — code inspection at repo revision
0c2ed650bcc947652ea5d3e5481eab17e827a711: crates/snapback/src/local.rs (delta candidacy,
`NoChange` handling, Remove-only auth guard, `already_resynced` exclusion),
crates/snapback/src/live_matcher.rs (`row_matches_query_filters`, `compute_live_delta`),
crates/snapback/src/storage/authorization.rs (membership writes as authorization events)]`

#### F2b. Prerequisite: the selection-identity fork

Neither Exact's logical query key (provider/authority partition, descriptor,
compatibility token, canonical arguments — no selection; same-key bindings
share one provider subscription; tuple construction, partition minting,
compatibility tokens, and canonicalization are normatively owned by Exact
LLP 0179 §8.1, and Draft Exact LLP 0263's ratified A1 amendment governs
binding lifetime, fencing, and same-key deduplication; Exact LLP 0216 is
general Contract background)
nor Snapback's store keys include a selection today. Selection must therefore either (a) enter the logical key —
the documented choice in Fate's request-cache identity, at the cost of
fragmenting previously-shared subscriptions —
or (b) stay out of the key, with each shared subscription maintaining the
*union* of its bindings' selections and per-binding masks, at the cost of
selection churn (upgrades/downgrades as bindings mount and unmount,
reconnect semantics). Any prototype must compare both arms on subscriber
count, payload savings, churn, and masking correctness. `[inferred]`

### F3. Masking is enforcement; suppression is economics

Contract already makes dependencies explicit and machine-checkable — `action
increment writes count`, typed `use ... from` bindings, the verifier over
the canonical IR (Exact LLP 0216 for background; the governing
data-binding contract is Draft Exact LLP 0263) — but at query granularity. Fate's masking
discipline extends the same philosophy one level down. Keep three distinct
payoffs separate:

- **Masking correctness (standalone in value).** Field-selection claims in
  the IR plus masked bindings make `accessed ⊆ declared` *enforceable* — a
  view cannot read an undeclared field — so declarations are provably honest
  and F2's hypotheses get trustworthy inputs. This has value even if nothing
  else ships; its *cost* is not small (see Confidence — grammar, IR,
  verifier, renderers, and helper inference all move).
- **Overfetch reporting (advisory).** The agent API reporting *declared
  minus accessed* fields is coverage-dependent telemetry: runtime access
  tracing cannot prove a declaration unused across unexecuted branches and
  helpers (unlike L4's complete fresh-query oracle), so treat it as a lint
  signal unless conservative static analysis supplies a proof.
- **Update suppression (a separate, larger change).** Masking alone does not
  reduce Contract effect executions: query delivery currently publishes a
  fresh rows signal per delivery and terminal bindings react independently
  (Exact runtime). Suppression additionally requires server-side
  invalidation filtering (F2) and/or selected-value equality checks at the
  publication boundary — measured by LLP 0052's churn metrics (derive/effect
  executions, host-update attempts), not re-render counts.

Field sets must also be typed — five, not four: payload fields (maskable),
**server read/output-derivation closure** (what the query's computation
actually consumes — unknowable today for opaque handlers, the F2 soundness
gate), filter/order dependencies, authorization/membership dependencies,
and identity/reconciliation metadata. Only the first is maskable;
invalidation must keep honoring the rest even when they are not delivered
(reinforcing F2a). Ownership note: the Contract language, compiler, IR, and
verifier are Exact's (Exact LLP 0216), as is the `ContractDataManifest`
(LLP 0037's scope fence; the Snapback-side mapping obligation sits with
LLP 0021) — and compiled selections would need
their own artifact, a two-phase pipeline, or carriage in the Contract IR
itself with runtime propagation, since the `ContractDataManifest`
is provider input generated from Snapback artifacts independently of
Contract compilation. Snapback owns the
provider mapping, wire representation, and server-side use of selections.
`[inferred]`

### F4. Normalized cache — a maybe, with a named layer and a safety bar

Snapback's client-side state has at least three owners, and any
normalization experiment must name its target:

- The **online external store** (LLP 0012; `@snapback/client/external-store`,
  used by the React arm): a framework-neutral, online-only, non-durable
  per-logical-query lifecycle and optimistic store with a thin React
  projection.
- The **Contract paths** (three as-built modes, none of which currently
  combines multi-query results with optimistic overlays): legacy
  single-query mode (an Exact `ContractQueryBoundary` written by the
  Snapback adapter, optimistic reducers, one bound query); legacy
  multi-live mode (multiple boundary entries, **no** optimistic publication
  turn — freshness is owned by the push); and keyed Contract (direct
  provider handles, no overlay). Two scopes must be kept apart: *within a
  surface*, no shipped Contract mode combines multi-query results with
  optimistic overlays; but an app may mount **several Contract surfaces
  over one physical store**, and each legacy single-query surface applies
  its optimistic reducers only to its own boundary — so two concurrent
  surfaces whose results share a row *can* diverge under an optimistic
  mutation today, exactly as the per-query React external-store path can.
  Cross-surface divergence is therefore a present-tense fact on both
  online paths — bounded by push reconciliation for live-bound surfaces,
  while a non-live sibling surface has no peer-refresh guarantee and may
  stay divergent until independently refreshed; its practical frequency
  (overlapping-row surfaces, divergence duration) is unmeasured and should
  gate prioritization. Any experiment should attach to the strategic keyed
  path, not the legacy boundary.
- The **DK-9 client-store contract** (LLP 0008 DK-9 as built:
  `packages/snapback-contract/client-store.mjs` —
  `createMemorySnapbackClientStore`, a deterministic reference that models
  reloads, and `createLocalStorageSnapbackClientStore`, the web-persistent
  adapter; durability depends on the backing adapter):
  retained results, stream/version cursors, authorization state, leases, and
  the mutation outbox, fenced by app, database, target profile, version
  stream, schema hash, inputs hash, and authority — not merely principal and
  query. As built: legacy single-query Contract accepts a `clientStore`
  for full retained-rows/outbox custody; legacy multi-live accepts one for
  durable authorization/invalidation custody only (retained rows and the
  offline outbox remain single-query-only); keyed Contract rejects one
  fail-closed (`SNAPBACK_CONTRACT_KEYED_OFFLINE_PENDING`); and the React
  external store is explicitly non-durable. Durable custody stacking beyond
  those as-built combinations is proposed architecture, not capability.

The attraction: the same entity in two query results can be momentarily
inconsistent under optimistic overlays; a Fate/Relay-style normalized cache
(records keyed by type + id — table + `_id` here; no globally-unique-ID
discipline required) would make overlays converge across queries. The
hazard: Snapback's model permits the same row to be visible through one
authorized subscription and absent through another (LLP 0008; LLP 0053), and
merging entity fragments across queries could leak fields learned under a
broader authorization context into a narrower or expired one — field masking
is not an authorization boundary. (Fate's public materials warn against
reusing request-scoped snapshots across users but do not address
authorization at Snapback's granularity; the comparison is `[inferred]`, not
a claim that Fate is unsafe.)

Constraints, by layer: a **durable** experiment must preserve the complete
DK-9 fence and carry per-field query/lease provenance; an **online**
experiment (either owner) must explain what convergence it delivers if
cross-query fragment reuse stays forbidden. A cheaper alternative to test
first: mutation-plan-driven overlay fan-out — apply an optimistic overlay
to another active query's result **only with a per-query visibility
proof**: the overlaid row must provably satisfy that query's arguments,
ordinary filters, membership predicates, authorization scope, and
reconciliation rules. Read-set relevance is an *invalidation* signal, not a
visibility proof, and opaque or unproven query instances receive no
cross-query overlay. This buys cross-query convergence without shared
entity fragments. Parked unless an overlay-heavy demo surfaces the
inconsistency in practice. `[inferred]`

### F5. Independent convergence on the agent-first thesis

Fate's "AI-Ready" pitch — explicit selection and a minimal API enable local
reasoning for humans and code-generating tools — converges with the bet
LLP 0000 makes (paraphrase). An unaffiliated, Relay-lineage project arriving
at the same framing is independent convergence, not validation evidence; it
is still a useful signal that "explicit, locally-analyzable data
dependencies" is a design pressure worth keeping, pushed down to field
granularity rather than relaxed. `[inferred]`

### F6. What not to adopt

Fate's SSE transport and client-driven fetch model solve a smaller problem
than Snapback's stack: durable WebSocket push with commit-versioned
consistency, server-scoped queries, and a durable client mutation outbox
with offline replay (LLP 0043). (Snapback's reconnect performs a fresh
subscribe/snapshot rather than durable stream resumption — LLP 0008; the
*client mutation outbox*, not the connection, is the durable half.) The
lesson to take is the declaration, masking, and field-aware invalidation
discipline — not the transport or the cache implementation.

## Confidence

Medium confidence in the description of Fate's model (public guides,
README, and 1.0 announcement read 2026-07-20; maturity statements
contradict each other; no source verification; no per-package version pin).
High confidence in F2a's discrepancy description — confirmed by direct code
inspection at a pinned revision during review — and in the description of
subscription granularity and delta eligibility, with the explicit caveat
that F2a shows the eligibility *boundary* is not currently
membership-enforced, so "everything else falls back" describes the design
intent, not verified behavior. The F2 hypotheses are unmeasured; the
fallback ceiling needs auth-era remeasurement before any uplift claim, and
hypothesis 1's pre-requery arm is gated on proven field lineage (the F2
soundness gate). Medium-to-low confidence in the Contract IR change's cost
(grammar, IR, verifier, renderers, helper-boundary inference).

## Recommendations

All `[inferred]`; benchmark-first, split by ownership.

1. **Corpus reconciliation — landed 2026-07-21**: LLP 0000, LLP 0008
   (body + Revised header), LLP 0035 (a prominent superseded-fixtures
   note), LLP 0034, LLP 0038, LLP 0051, and the `crates/snapback/src/live_matcher.rs` doc
   comment now qualify every pre-`37f1a2f` ceiling and the ~5 200× ratio
   as superseded fixture results, preserved as history. (LLP 0032's dated
   plan-ledger entries are left as history by design.) Corrected numbers
   propagate only after the replacement run is recorded.
2. **F2a repair — landed 2026-07-21** (fail-closed candidacy +
   `compute_live_delta` guards, unit regressions, `NoChange` oracle
   extension; LLP 0008/0056 updated). Remaining follow-up worth a tracked
   issue: the end-to-end per-auth-mode regression matrix (both membership
   visibility directions, dev and sessions modes, Shindig `eventDetails` as
   the fixture). Any selection prototype treats membership/auth predicates
   as a safety dependency it may narrow but never replace.
3. **Snapback-side: measure before protocol work.** Re-run **both paths**
   (fallback and delta) on the corrected harness under the current
   protected-query profile, recording result-set size, auth profile,
   affected and total subscriber counts, and enqueue/drain scope with each
   result — reporting compute-only and delivery-inclusive stages
   separately; then test
   the F2 hypotheses with a **shadow decision** — compute whether each
   update *would* have been suppressed or projected while the authoritative
   full path still executes, and compare (the L4 real-oracle pattern,
   without putting correctness behind an experimental skip). The shadow run
   is *measurement evidence, not a graduation proof*: it must include
   derived-output and helper-based counterexamples, and pre-requery
   suppression can only ever graduate for proven-lineage query classes (F2's
   soundness gate). The same harness should evaluate the membership
   predicate in shadow, turning F2a's safety flag into a measured
   delivery-difference number. Compare both F2b arms (a two-tier design —
   shared-evaluation key plus a canonical selection hash for projection
   cells — need not be binary) and the shared-evaluation control. Only file
   wire-protocol work if selection wins; any wire change is shared surface
   sequenced with the LLP 0034 delivery/wire work (LLP 0008 DK-3's
   revisit-note constraint).
4. **Exact-side: masking as standalone enforcement.** Selection syntax/IR,
   masked bindings (`accessed ⊆ declared` enforced), helper-boundary
   widening rules, verifier claims, and advisory declared-vs-accessed
   telemetry in the agent API. File in the Exact tracker; standalone value
   (honest declarations) even if the protocol half never ships.
5. **Park the normalization experiment** behind F4's layer choice and safety
   constraints; test mutation-plan-driven overlay fan-out first if
   cross-query overlay inconsistency ever bites in a demo.

## Open questions

- What guard or regression test should establish the intended
  `membership_filters` → conservative-lane boundary (F2a), and does the fix
  belong in delta candidacy, row classification, or both — including the
  membership-table-write vs main-table-write directions?
- Selection in the logical query key, or union-maintained per shared
  subscription (F2b)? If unioned: upgrade/downgrade, reconnect, and
  concurrent mount/unmount semantics; if keyed: how much subscription
  fragmentation do real screens produce?
- Which fields must remain subscribed even when no view reads them — filter
  and ordering inputs, authorization/membership dependencies, identity and
  reconciliation metadata — and where is that set computed (compiler vs
  server)?
- Do selections version with the artifact? LLP 0043 keys retained state by
  the artifact/schema hashes in the DK-9 fence; a selection change alters
  what retained rows contain,
  touching the offline retention contract, not just the live path.
- Can field selections be expressed without breaking LLP 0037's
  source-of-truth rule (selection as a projection over generated types,
  recorded in the manifest across the Exact/Snapback authority boundary),
  and which compatibility token changes when the mapping changes?
- Can Contract conservatively infer nested field access through computed
  paths and imported helpers, or must helpers export explicit field
  summaries?
- Which realistic workloads have enough unselected-column churn for
  hypothesis 1 to matter (vs. merely reducing bytes), and how large is the
  identical-watcher cohort that the shared-evaluation control exploits?
- Which query classes can provide a sound source-field-to-output-field
  dependency closure (the F2 soundness gate), and what capability marker in
  the manifest proves it?
- Must `_version` and other reconciliation metadata advance on every
  underlying row change? If so, unselected-column suppression may reduce to
  metadata-only delivery rather than full invalidation suppression — an
  explicit hypothesis falsifier for the benchmark.
- Ephemeral state declares value shapes via collection validators
  (LLP 0013), not the durable schema — can masking bind to that declaration
  source, or is masking simply out of scope for ephemeral payloads?
