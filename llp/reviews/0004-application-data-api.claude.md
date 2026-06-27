# Review: LLP 0004 — Application data API

**Reviewed:** `llp/0004-application-data-api.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against the in-repo document; no document
content was sent to any external provider beyond the model serving this Claude
Code session.
**Method:** Single-session, independent read-and-critique of the full document
at its uncommitted working-tree state.

> **Independence (LLP 0005).** This session did **not** author the draft — it was
> drafted by Charlie Cheever / Codex (a GPT-family agent). A Claude review is
> therefore genuinely cross-family. This is **one** family's review. Because this
> API is "a load-bearing contract for agents... the surface generated apps will
> use constantly," a second non-author family before the doc leaves `Draft` is
> more warranted here than for 0003, though still secondary to validating the API
> against a real reference app.

## Overall assessment

This is the strongest-DX document in the set, and rightly so — it is the surface
agents touch most. The three-layer split (schema / handler / client) with the raw
wire protocol explicitly *not* the product API is the right altitude and is
agent-legible. Portability-by-default-with-explicit-opt-out is faithful to LLP
0000's hard requirement, and the agent-feedback section turns "agent-first" into
concrete obligations (codegen fails loud, unknown tables/fields caught early,
runtime errors name the function/args/op).

My most important finding is small to fix but real: **the document's flagship
example violates two of its own rules.** `createTodo` calls `Date.now()`, which
the same RFC bars from handlers (it requires injectable timestamps for offline
replay, and bars non-deterministic time from queries), and the example's
user-space `createdAt` field duplicates the `_createdAt` system field that LLP
0003 already provides. An agent learning the API from this example would learn the
anti-pattern. I fixed the example and surfaced the rest as constraints/open
questions. The deeper, non-editorial gaps — the reactivity mechanism, money/binary
representation, and how arbitrary-function queries coexist with
authorization-aware sync — I left for the author and the storage/sync/auth
follow-ons, flagged below.

## Strengths

- **Right layering, right altitude** (*API Layers*). "The raw HTTP/WebSocket
  protocol is not the product API. It is an implementation detail that carries
  generated API calls" — this is the sentence that keeps the contract stable
  across local/Cloudflare/hosted targets, which is the whole point of splitting
  it out of LLP 0003.
- **Portability as a default with a named opt-out** (*Portability Rules*). Schema
  types need a portable representation, query-builder ops need engine-independent
  semantics, "raw SQL is not part of the paved path," and engine-specific features
  "require an explicit opt-out from portability." This is LLP 0000's hard
  constraint made operational.
- **Agent feedback as a contract** (*Agent Feedback Requirements*). Failing
  codegen loudly, catching unknown tables/fields early, and including
  function/args/op in runtime errors is exactly the self-correction loop
  agent-first DX needs.
- **Determinism instinct** (*ctx.db Contract*). Keeping time/random/network out of
  queries is the correct Convex lesson and the precondition for caching and
  reactivity — even though the mechanism that exploits it is still open (C4).
- **Honest provisionality.** "The concrete hook and helper names... are
  illustrative unless a later Spec fixes them" and the explicit *Deferred Work*
  list keep the doc from over-committing names while still being concrete enough
  to build against.

## Concerns

Severity reflects impact on an agent building against this API.

- **C1 — The flagship mutation example calls `Date.now()`, contradicting the
  doc's own determinism + injectable-timestamp rules. [Medium-High]**
  *Handler API* shows `createTodo` setting `createdAt: Date.now()`. But *Write
  Semantics* requires timestamps be "injectable through the runtime so offline
  replay can produce stable inserts and timestamps," and *ctx.db Contract* bars
  non-deterministic time. `Date.now()` on an optimistic client and on the
  authoritative server produce different values, breaking the "both executions
  should see the same `ctx.db` semantics" parity the doc demands one section
  later. Since this is the canonical teaching example, the anti-pattern is what an
  agent will copy. *Resolves when:* the example draws time (and ids) from the
  injected runtime source, never `Date.now()`/`Math.random()`. (Applied: rewrote
  the example and added a one-paragraph note.)

- **C2 — The example's user-space `createdAt` duplicates LLP 0003's `_createdAt`
  system field. [Medium]**
  LLP 0003 gives every table `_createdAt`/`_updatedAt`. This doc's schema also
  declares `createdAt: v.number()` and sets it by hand — two creation timestamps,
  different names, different provenance, one manual and one system-owned. Agents
  won't know which is canonical. *Resolves when:* the example relies on the system
  field for creation time and reserves user fields for domain data. (Applied:
  dropped the duplicate; `listTodos` now orders by `_createdAt`.)

- **C3 — "JSON-serializable returns" + a single `v.number()` cannot express money
  or binary; this collides with the finance and asset reference apps.
  [Medium-High]**
  *Handler API* requires JSON-serializable documents, and the validator example
  offers `v.number()` (a JS double). IEEE-754 doubles cannot represent 64-bit
  integers or exact decimal money, and JSON has no binary type. LLP 0000's finance
  reference app demands "money-grade write correctness" and the asset path is
  photo/video-first. As written, the paved-path types quietly cannot carry two of
  the reference workloads. *Resolves when:* the validator vocabulary distinguishes
  integer/decimal from float, and the serialization contract carries big
  integers/decimals/binary out-of-band rather than assuming plain JSON. (Applied:
  added a portability bullet + a qualifier on the JSON-serializable line + an open
  question; I did not pick the encoding.)

- **C4 — The reactivity mechanism — how a committed write maps to which subscribed
  queries must re-run — is unspecified, and it is the load-bearing unknown.
  [Medium]**
  The named query is "the unit clients subscribe to" and queries must be
  deterministic, but nothing says how the server learns a live query's *read-set*
  so a change invalidates exactly the right subscriptions. This is LLP 0001's open
  question ("Convex-grade reactivity on a standard relational store") and the hinge
  between this doc's queries and LLP 0003's subscription matcher. Left implicit,
  each layer can assume the other owns it. *Resolves when:* the doc names read-set/
  dependency tracking as the reactivity mechanism to be specified, and cross-links
  0003's matcher and 0001's open question. (Applied as a sentence in *Relationship
  To Sync And Realtime* + an open question.)

- **C5 — Arbitrary server-executed function queries are in tension with
  authorization-aware partial sync. [Medium]**
  A query may be "a server-executed function" (opaque JS), yet partial sync must
  be authorization-aware (the card-game reference app) and reactive. An opaque
  function can't be analyzed for what it reads, whether its results leak rows a
  viewer may not see, or which changes should re-run it. Meanwhile the table-level
  `.sync({ filter })` and function-level query subscriptions are two different
  authorization surfaces whose relationship is undefined. *Resolves when:* the doc
  states which query forms can back a live, authorization-aware subscription
  (analyzable builder queries) vs. which are server-only/non-subscribable, and how
  `.sync` filters compose with query subscriptions. (Applied as an open question.)

- **C6 — The `_id` type/opacity is unspecified though it is load-bearing for
  offline minting + portability. [Low-Medium]**
  `get/patch/delete(id)` plus "generated IDs... injectable" imply clients mint ids
  offline, but the id's type and format (opaque string/ULID vs. SQLite rowid vs.
  Postgres bigserial) is never stated — and it must be collision-safe across
  offline clients and identical across SQLite/Postgres. *Resolves when:* ids are
  specified as opaque, client-mintable, engine-independent strings, or the
  question is deferred with that constraint recorded. (Applied as an open
  question.)

- **C7 — `skip(n)` offset pagination is a scale footgun for the large-dataset
  reference apps. [Low]**
  `take`/`skip` is offset paging — O(n) and unstable under concurrent writes —
  yet the Linear/Notion reference apps (LLP 0000) hinge on large local datasets and
  snappy paging. *Resolves when:* a note flags cursor-based pagination as the
  intended scale path and `skip` as a small-data convenience. (Applied as an open
  question.)

- **C8 — `filter((q) => …)` reads ambiguously against the structured `eq/neq/…`
  operators. [Low]**
  A `filter` taking a JS callback implies in-process evaluation (un-pushdownable);
  the separate `eq/neq/lt/…` operators imply a structured DSL that pushes down.
  The doc's "map to pushdown when possible, diagnose when not" intent is right, but
  the example signature blurs whether `filter` predicates are structured or
  arbitrary JS. *Resolves when:* the doc clarifies `filter` takes a structured
  predicate expression, not arbitrary JS. (Noted as a suggestion; not rewritten —
  it touches the builder's shape, which is the author's call.)

## Suggestions (non-blocking)

- Make `filter` predicates explicitly a structured expression DSL (Convex-style
  `q.eq(q.field('x'), v)`), so "pushdown when possible" has a syntactic basis and
  the "fall back to in-process evaluation" path is the exception an agent is warned
  about, not the default the signature invites.
- When auth lands, give the canonical example a real auth stub: as written it
  depends on `ctx.auth.userId`, which the first slice (LLP 0003) defers, so the
  flagship example cannot actually run end-to-end on the canonical target yet.
- State the `_id`/`_version`/`_createdAt`/`_updatedAt` system-field set *in this
  doc* (even by reference to LLP 0003), since this is the API surface where agents
  meet those fields.

## Open questions (for the author / follow-on Specs)

- Time/id injection shape: what does the runtime expose to handlers in place of
  `Date.now()`/`Math.random()`?
- `_id` type/format: opaque client-mintable string vs. engine-native id.
- Reactivity: how is a live query's read-set tracked for invalidation?
- Authorization-aware subscriptions: which query forms qualify; how do `.sync`
  filters compose with query subscriptions?
- Money/binary: exact integer/decimal and binary representation across validators,
  wire format, and SQLite↔Postgres.
- Pagination: cursor vs. offset for the large-dataset apps.

## Recommended next step

*Proposed only — the author decides; this review changes no `**Status:**`.*

1. **Status stays `Draft`.** I did not change it. The status note's gate — revise
   alongside the local-core prototype, formalize into a Spec once it survives a
   reference app — is the right one.
2. **Charlie reviews the diff** I applied (C1–C3 partial, C4–C7 as notes/open
   questions). The example rewrite (C1/C2) is the one change with visible teeth;
   the rest surface gaps without deciding direction.
3. **Validate against a reference app** — the todo floor first, then one that
   actually exercises the gaps (the card game for authorization-aware sync, the
   finance app for money types). This will force C3–C5 into decisions faster than
   more review will.
4. **A second non-author family** is more warranted here than for 0003 given the
   contract's reach; on request I can prepare the LLP 0005 prompt, but per the
   honesty rules I will not run it externally or record an unproduced review
   without an explicit human action. (Session sub-agents are all Claude-family.)
