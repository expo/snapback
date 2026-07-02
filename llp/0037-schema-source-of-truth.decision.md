# LLP 0037: Schema source of truth — Rust types, generated JSON Schema

**Type:** Decision
**Status:** Accepted
**Systems:** API, Tooling, Client integration, Contract/Exact, Testing, Packaging
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-02
**Revised:** 2026-07-02 (ratified same day: Rust-first; DK-7 decided)
**Related:** LLP 0004, LLP 0012, LLP 0016, LLP 0020, LLP 0024, LLP 0032

## Summary

Every shared Snapback artifact shape — the schema manifest, function manifest,
capability manifest, diagnostic schema, runtime state, and (when built) the
host-ops result envelope — gets **one** source of truth: **the Rust types the
server actually parses and emits**. JSON Schemas are **generated from those
types** and committed in-repo; JavaScript codegen and tools **validate against
the committed schemas**; a Rust snapshot test regenerates and diffs them, so
schema drift fails CI instead of surfacing as a runtime mystery.

This is docket row **DK-7** of
[LLP 0032](./0032-decision-and-implementation-hardening.plan.md) — the
corpus's most-repeated open question:
[LLP 0016](./0016-diary-driven-change-program.plan.md) blocks Phase 1 on it,
[LLP 0020](./0020-core-authoring-surface.plan.md) and
[LLP 0024](./0024-agent-operating-surface.spec.md) carry it as their open
question, and [LLP 0012](./0012-headless-integration-contract.spec.md)
§Versioning demands exactly this single-source-plus-drift-gate shape from
Valet's experience with two hand-synced protocol files.

## Context

- The Rust server is the component that *ingests* the manifests
  (`src/manifest.rs`: `SchemaManifest`, `TableManifest`, `FieldManifest`,
  `IndexManifest`, `FunctionManifest`, `CapabilityManifest`) and fails closed
  on what it does not understand. Whatever any other artifact claims, the
  serde shapes are what the system accepts. Authority already lives there in
  practice; this decision makes it official rather than accidental.
- Today the JS emitter (`demos/_kit/codegen.mjs`) hand-mirrors those shapes,
  including a hardcoded capability-manifest literal that LLP 0032 P2 exists
  to delete. Nothing validates a generated artifact against anything; the
  S5.D2 invalid-TypeScript bug shipped because no gate consumed the output.
- Valet's lesson ([LLP 0012](./0012-headless-integration-contract.spec.md)
  §Versioning): two hand-synced definitions of one protocol *will* drift;
  define each shared shape once and gate the drift in CI.

## Options

1. **Rust-first (recommended).** The serde types in the Rust core are the
   source of truth. JSON Schemas are generated from them (`schemars`-style
   derive) and committed under a repo-visible `schemas/` directory. JS
   codegen validates every artifact it emits against the committed schema;
   adapters and tools validate what they consume. A Rust test regenerates
   the schemas and fails on diff (the drift gate). TypeScript types for
   artifacts remain *generated outputs*, never authorities.
2. **Hand-maintained schema repo.** Independent JSON Schema files that both
   Rust and JS consume. Rejected: it re-creates the two-sources problem as a
   three-sources problem — now the Rust parser needs its own drift gate
   against the schema files, and nothing structurally prevents the schemas
   from describing shapes the server does not accept.
3. **TypeScript-first.** The codegen package owns the shapes; Rust validates
   against schemas generated from TS. Rejected: it inverts authority — the
   server's fail-closed serde parsing *is* the runtime behavior, so a TS-first
   schema can only ever be a claim about the server, checked after the fact.
   The component that enforces the contract should be the one that defines it.

## Decision (ratified 2026-07-02)

**Option 1 — Rust-first.** Concretely:

- The serde types in the Rust core are the single source of truth for every
  Snapback-owned shared artifact shape: schema manifest, function manifest,
  capability manifest, diagnostic schema, runtime state, and the host-ops
  envelope when [LLP 0024](./0024-agent-operating-surface.spec.md)'s first
  slice lands.
- JSON Schemas are generated from those types and committed at `schemas/`
  (repo root, consumable without a cargo toolchain). Each schema carries the
  artifact's `schemaVersion`; a schema change is a reviewable diff.
- A Rust snapshot test regenerates the schemas and fails on any diff — the
  CI drift gate [LLP 0012](./0012-headless-integration-contract.spec.md)
  §Versioning requires.
- JS codegen validates each artifact it emits against the committed schema
  before writing it; consumers (adapter, kit, admin) may validate what they
  read. Validation failures are structured diagnostics, not thrown strings.
- The capability manifest is additionally **server-computed**, not just
  server-shaped — LLP 0032 P2 deletes the JS literal; this decision supplies
  the schema half of that step.

**Scope fence.** This governs *Snapback-owned* artifacts. The
`ContractDataManifest` is Exact-owned (Exact 0263 §4.2, decision 7);
Snapback's obligation there is a correct, validated **mapping** from its
native manifests onto Exact's shape
([LLP 0021](./0021-contract-exact-integration-hardening.plan.md) open
question), not schema authority over it.

## Consequences

- LLP 0032 **P3(c)** implements the mechanism (schemars derives, committed
  `schemas/`, the drift-gate test, codegen-side validation); **P2** consumes
  it for the capability manifest.
- [LLP 0016](./0016-diary-driven-change-program.plan.md) Phase 1's blocking
  open question is answered; the remaining Phase 1 blocker is the
  `ContractDataManifest` mapping, which stays with LLP 0021.
- [LLP 0020](./0020-core-authoring-surface.plan.md) and
  [LLP 0024](./0024-agent-operating-surface.spec.md) resolve their
  source-of-truth open questions by reference to this document.
- Adding a field to a shared artifact now means: change the Rust type,
  re-run the schema snapshot, and let the gate walk you through every
  consumer — instead of remembering which JS literals to touch.

## Revisit triggers

Reopen this decision if either occurs:

- a shared artifact appears whose natural owner is not the Rust core (for
  example, a client-only artifact no server ever parses) — decide its
  authority explicitly rather than defaulting it into `schemas/`;
- the generated-schema toolchain cannot express a needed contract precisely
  enough that hand-authored schema fragments start accumulating beside the
  generated ones — two sources again, the exact failure this decision exists
  to prevent.

## Status

Accepted. Ratified 2026-07-02 by Charlie (decision drafted and applied by
Claude (Fable 5) under Charlie's same-day delegation). Ledgered in
[LLP 0000](./0000-snapback.explainer.md); docket row DK-7 closed in
[LLP 0032](./0032-decision-and-implementation-hardening.plan.md).
Implementation lands via LLP 0032 P2/P3.
