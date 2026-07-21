# LLP 0067: Fate — lessons for Snapback and Contract

**Type:** Research
**Status:** Draft
**Systems:** Live Queries, Sync, Realtime, Client integration, Contract/Exact, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-20
**Revised:** 2026-07-20 (initial research synthesis)
**Related:** LLP 0000, LLP 0001, LLP 0005, LLP 0008, LLP 0012, LLP 0035, LLP 0043, LLP 0066, https://fate.technology, https://github.com/nkzw-tech/fate

## Summary

Fate (fate.technology, Nakazawa Tech / Christoph Nakazawa, MIT) is a data
client for React that applies Relay's core innovations — co-located data
requirements, fragment composition, normalized caching, data masking — to
plain type-safe TypeScript RPC, with no query language and no codegen
compiler. It markets itself as "AI-Ready": "minimal, predictable API and
explicit data selection enable local reasoning" — Snapback's own agent-first
thesis, stated independently.

Fate is more directly relevant to Snapback than Effect (LLP 0066) because it
works the same seam: declared data dependencies flowing from UI components to
a typed RPC backend, with realtime updates merged into a client cache. Three
ideas are worth pulling, in descending order of leverage:

1. **Screen-level request composition driven by declared views** — the idea
   with real architectural bite, because it attacks the live-query fan-out
   ceiling (LLP 0008 DK-3, LLP 0035) from the client side.
2. **Field-level data masking in Contract** — enforce that a view can only
   see fields it declared, and re-render only when those fields change.
3. **A normalized entity cache as an opt-in client arm** — cross-query
   consistency for optimistic overlays; a maybe, not a must.

## How to read this — provenance and confidence

Claims about Fate come from fate.technology and the `nkzw-tech/fate` README
(v1.3.x), read 2026-07-20; not verified against Fate's source. Claims about
Snapback and Contract cite the governing LLPs. Recommendations are
`[inferred]`.

## Findings

### F1. Fate's model, briefly

- A **view** declares exactly the fields a component needs
  (`view<Post>()({ title: true, author: UserView })`); views compose by
  reference, not inline selection.
- **Data masking**: a component can only access fields its view declared;
  undeclared data is hidden even when present in the cache. Components
  re-render only when a *selected* field changes.
- `useRequest` at a screen boundary composes all descendant views into **one
  network request** — no waterfalls, no overfetch.
- A **normalized cache** keyed by global identifiers backs everything;
  optimistic updates roll back on failure.
- **Live Views** stream updates over a single SSE connection into the
  normalized cache.
- All plain TypeScript inference — Fate's stated reason for existing is that
  Relay's ideas shouldn't require adopting GraphQL when you already have
  typed RPC.

### F2. Declared views vs. Snapback's query-grained subscriptions

Snapback's live queries subscribe at the granularity of a named server query
(LLP 0008): the client gets snapshots plus `live_replace` or, for the
analyzable single-table subset, `live_delta`. LLP 0008 DK-3 and LLP 0035
record the unresolved consequence: warm-VM whole-query fan-out caps at ~5–6
subscribers per commit, and ordered/limited/Ibex-shaped queries fall back to
`live_replace`.

Fate demonstrates the client-side half of a mitigation: if every component
declares a field-level view and the screen composes them, the client knows the
*exact* dependency set of the screen. Snapback owns both ends of the wire —
unlike Fate, which sits on generic RPC — so a composed, field-selected
subscribe could also inform the server: narrower invalidation (a commit
touching an unselected column need not fan out), smaller payloads, and a wider
effective `live_delta` subset because the selected projection is more often
analyzable than the full query shape. This is the highest-leverage idea in
this document. `[inferred]`

### F3. Data masking is the enforcement Contract is missing

Contract already makes dependencies explicit and machine-checkable — `action
increment writes count`, typed `use ... from` bindings, the verifier over the
IR — but at query granularity. Fate's masking discipline extends the same
philosophy one level down: a view *cannot* read a field it did not declare, so
declarations are guaranteed honest. For Contract this would mean
field-selection claims in the IR, enforced by the verifier and by the runtime
(masked bindings), which buys three things: provable "this view touches only
these fields" claims, minimal re-renders in the Exact renderers, and the
trustworthy per-screen dependency sets that F2 needs as input. Exact's agent
API could additionally report *declared vs. accessed* fields per view, turning
overfetch into a checkable lint in the verify-and-repair loop. `[inferred]`

### F4. Normalized cache — a maybe

Snapback's store-agnostic client is a per-query result cache plus cursor and
outbox (LLP 0008 DK-9). The same entity appearing in two queries can be
momentarily inconsistent under optimistic overlays; a Fate/Relay-style
normalized cache keyed by global IDs would make overlays converge across
queries. But live queries already solve most cross-query staleness
server-side, and normalization imposes a global-identifier discipline on the
schema. Worth considering only as an *opt-in* client arm (LLP 0012 frames
arms as pluggable) for offline-heavy or overlay-heavy apps — not as a change
to the default client. `[inferred]`

### F5. Independent confirmation of the agent-first thesis

Fate's "AI-Ready" pitch — explicit selection and a minimal API enable local
reasoning for humans and code-generating tools — is the same bet LLP 0000
makes. That an unaffiliated, Relay-lineage project converged on the same
framing is mild external validation that "explicit, locally-analyzable data
dependencies" is the right design pressure, and that Contract should keep
pushing declarations *down* to field granularity rather than relaxing them.

### F6. What not to adopt

Fate's SSE-based Live Views and its client-driven fetch model are weaker than
what Snapback already has (durable WebSocket push, server-scoped queries,
commit-versioned consistency, offline outbox). The lesson is the declaration
and masking discipline, not the transport or cache implementation.

## Confidence

High confidence in the description of Fate's public model and of Snapback's
current subscription granularity. Medium confidence that field-selected
subscriptions materially raise the fan-out ceiling — that claim needs
benchmarking against LLP 0035 before it justifies protocol work. Medium
confidence in the Contract IR change being tractable; it touches the grammar,
IR, verifier, and both renderers.

## Recommendations

1. File the Contract-side issue: field-selection claims in the `.contract` IR
   plus screen-level composed subscribe, explicitly tied to the LLP 0008 DK-3
   fan-out ceiling. Prototype against an LLP 0035-style benchmark before
   committing to protocol changes.
2. Add masked bindings + declared-vs-accessed reporting to the Exact agent
   API wishlist alongside (1) — they share the IR work.
3. Park the normalized-cache arm unless an offline-heavy demo surfaces the
   cross-query overlay inconsistency in practice.

## Open questions

- Can field selections be expressed without breaking LLP 0037's rule that
  Rust types are the schema source of truth (selection is a projection, not a
  new type — but the manifest must say so)?
- Does per-field invalidation belong in the op-log analysis (server decides)
  or in the subscribe payload (client declares)? Both halves exist in Fate;
  Snapback could do either or both.
- How do masked views interact with ephemeral state (LLP 0013), which has no
  schema-derived field set?
