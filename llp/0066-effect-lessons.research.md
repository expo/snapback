# LLP 0066: Effect — lessons for Snapback

**Type:** Research
**Status:** Draft
**Systems:** API, Runtime, Sync, Cron, Developer experience, Client integration
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-20
**Revised:** 2026-07-20 (initial research synthesis)
**Related:** LLP 0000, LLP 0001, LLP 0004, LLP 0008, LLP 0037, LLP 0043, LLP 0047, LLP 0052, LLP 0067, https://effect.website, https://www.npmjs.com/package/@effect/workflow

## Summary

Effect (effect.website) is a functional effect-system and runtime for
TypeScript: a unified `Effect<Success, Error, Requirements>` type carrying
typed error channels, tag-based dependency injection (Layers), declarative
retry policies (`Schedule`), structured concurrency, streams, OpenTelemetry
observability, and — most recently — Effect Cluster / `@effect/workflow` for
durable, sharded, replayable workflows. Its adoption grew through 2025–2026 as
teams hit the operational limits of plain async TypeScript.

Most of Effect's value propositions Snapback already delivers by different
means, and this research is partly a validation exercise: the overlaps confirm
existing design choices rather than motivating change. Two areas are genuine
gaps that Effect's designs illuminate:

1. **Durable multi-step workflows.** Snapback has none (LLP 0000 acknowledges
   this; durability today is outbox replay per LLP 0043 plus the cron
   run-ledger). `@effect/workflow`'s replay model is the reference
   architecture to study before designing one.
2. **Retry policies as declarative data.** Effect's `Schedule` makes retry
   behavior a composable, inspectable value. Snapback's retry behavior is
   baked into client-arm code, invisible to manifests and verifiers.

Effect's *programming model* itself should not be adopted: its viral monadic
style conflicts with Snapback's agent-first bet on plain, locally-reasonable
surfaces.

## How to read this — provenance and confidence

Claims about Effect are drawn from effect.website, the `@effect/workflow`
package documentation, and secondary 2026 ecosystem writing, all read
2026-07-20; none are verified against Effect's source. Claims about Snapback
cite the governing LLPs. Recommendations are `[inferred]` — the author's
synthesis, not settled decisions.

## Findings

### F1. Typed errors as values — Snapback already aligned

Effect's headline feature is that failure modes live in the type system
("never try & catch again"). Snapback's equivalent is structural rather than
type-parametric: stable `SNAPBACK_*` diagnostic codes with
`code`/`severity`/`details`, asserted on codes not prose
(`guide/operating/diagnostics.md`), and Contract's `async` blocks that make
`loading` / `error` / `empty` / `ready` declared UI states rather than thrown
exceptions. For a UI-facing surface authored by agents, the declared-state
form is arguably better than an error channel threaded through every function
signature. **No change recommended.** `[inferred]`

### F2. Schema as single definition with derived codecs — already aligned

Effect Schema derives encoder and decoder from one definition and turns parse
failures into typed errors. Snapback's Rust-types-as-single-source-of-truth
codegen (LLP 0037) is the same principle with a stronger enforcement story
(committed generated schemas, CI drift gates). **No change recommended.**

### F3. Durable workflows — a real gap, and a good reference design

`@effect/workflow` (alpha, on Effect Cluster) is the design to study:

- A **workflow** is identified by a deterministic execution ID derived from an
  **idempotency key** mapped from the payload.
- An **activity** is a durable step whose result is persisted on first
  completion and **replayed** on retry — re-execution skips completed
  activities instead of re-running them.
- Cluster maps each workflow to a sharded entity (consistent hashing routes
  messages to the owning runner), giving single-writer semantics per
  workflow instance.

This persisted-activity-replay model is a much smaller lift than a
Temporal-style event-sourced engine, and it composes naturally with machinery
Snapback already has: commit versions and receipts (LLP 0004), the outbox's
idempotency and ambiguity handling (LLP 0043, LLP 0052), and the cron
run-ledger. A Snapback "durable actions" design could plausibly be: an action
declared as a workflow gets an idempotency-keyed run row; each `ctx`-mediated
step records its result at commit time; a crashed or retried run replays
recorded step results and resumes. `[inferred]`

The gap matters because agents build apps that need multi-step effects —
payment flows, email sequences, external-API orchestration — and today the
honest answer is "compose cron + outbox + your own state machine."

### F4. Retry policies as data (`Schedule`)

Effect models backoff, jitter, caps, and composition of retry policies as
first-class values, separate from the code being retried. Snapback's outbox
retry behavior is uniform and hard-coded in the client arms. Making per-
mutation or per-action retry policy a small declarative surface in the
manifest would fit the machine-checkable-claims ethos: Contract's verifier
could then *prove* a mutation's retry semantics rather than infer them, and
`SNAPBACK_MUTATION_CONFLICT`'s reconcile-don't-retry rule could be expressed
as policy rather than convention. `[inferred]`

### F5. Observability conventions

Effect ships OpenTelemetry tracing as a first-class runtime concern. Snapback
has `/inspect`, the admin console, and structured diagnostics but no span
model correlating a mutation across client outbox → wire → commit → live-query
fan-out. Worth keeping in mind if operating at scale becomes a theme; not
urgent. `[inferred]`

### F6. What not to adopt

Effect is viral the way async is viral: once one function returns an Effect,
its callers tend to. The learning curve (generators, Tag DI, Layers) is real
and is the most common criticism even from adopters. Snapback's authoring
surface is deliberately plain — schema objects, async handlers, structured
results — because agents (and humans) reason locally over it. Importing
Effect's model, or an Effect dependency, into the authoring surface would
trade away that bet for guarantees Snapback already gets structurally.

## Confidence

High confidence in the descriptions of Effect's public surface and in the
mapping to Snapback's existing mechanisms. Medium confidence in F3's sketch of
how a durable-actions design would compose with receipts/outbox — that needs
its own RFC. Low confidence on priority ordering; no user demand signal yet
for durable workflows beyond the explainer's own gap acknowledgment.

## Recommendations

1. When durable workflows are scheduled, open an RFC citing this document and
   `@effect/workflow`'s idempotency-key + persisted-activity-replay design;
   evaluate it against the existing receipt/outbox machinery before inventing
   a new model.
2. Treat `Schedule` as the reference shape if retry policy ever moves from
   client-arm code into the manifest.
3. Do not adopt Effect as a dependency or emulate its effect type in the
   authoring surface.

## Open questions

- Does the local SQLite/Ibex target need sharding at all, or is the
  single-process case simple enough that only the Cloudflare target needs an
  entity-routing story?
- Should durable workflows be a server-side concept (actions) or also reach
  the client outbox (multi-mutation sagas)?
- Where does the run/step ledger live relative to LLP 0007's portability
  contract?
