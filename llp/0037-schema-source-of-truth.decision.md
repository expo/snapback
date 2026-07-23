# LLP 0037: Schema source of truth — Rust types, generated JSON Schema

**Type:** Decision
**Status:** Accepted
**Systems:** API, Tooling, Client integration, Contract/Exact, Testing, Packaging
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-02
**Revised:** 2026-07-23 (LLP 0079 SC-3: standing name-keyed-encoding constraint added with its enforcement mechanism, external evidence LLP 0078 F2c/A1; pending Charlie's ratification as an amendment to this Accepted decision); 2026-07-16 (ENG-24920 companion amendment); 2026-07-13 (ENG-24596: recorded narrow Rust-owned schema projections for non-serializable secret wrappers and the shipped host-ops/readiness/auth DTO schemas); 2026-07-02 (ratified same day: Rust-first; DK-7 decided)
**Related:** LLP 0004, LLP 0012, LLP 0016, LLP 0020, LLP 0024, LLP 0032, LLP 0057

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

## Dated alignment: agent-auth generated schemas (2026-07-16)

LLP 0055/0056 add no second schema authority. Agent credential/request/result
DTOs, service-principal attribution, function `authorityCreating`, manifest
encodings for `v.principal` and membership declarations, and role-denial
details are Rust/serde-owned wire shapes with committed generated JSON Schemas
where they cross process or language boundaries. JavaScript authoring helpers,
generated membership methods, and role-literal TypeScript unions are derived
outputs, not competing wire authorities. Codegen may derive values such as the
authority-creating marker, but the server manifest types remain the parser and
schema authority.

## Dated constraint: name-keyed encodings

*(2026-07-23, LLP 0079 SC-3 — pending Charlie's ratification as an amendment
to this Accepted decision.)*

**Standing rule:** no Snapback-owned persisted or wire encoding may depend on
declaration order surviving edits. Enum-like values, fields, columns, and
variant tags stay **name-keyed** — the serialized form carries the variant or
field *name* (as a scalar for unit variants, or as the object key for
data-bearing variants), never the declaration index. Any future by-index
encoding is an explicit decision with a named reason recorded in this
document, not a default.

External evidence (LLP 0078 F2c): Serverpod's default by-index enum
persistence silently corrupted data on reorder and had to be flipped to
name-keyed in a breaking 3.0 change. The 2026-07-23 repo audit (LLP 0078 A1)
verified Snapback passes today — this section makes the property a stated
constraint rather than an emergent one.

**Enforcement (LLP 0079 SC-5, plan-added):** `tests/name_keying_guard.rs`
runs in `cargo test` (and therefore the local proof and CI) with two parts:
a semantic pin asserting the exact name-keyed JSON of representative
Snapback-owned enum encodings (unit and data-bearing `FieldType` forms in
the schema manifest; every `live_wire` op-kind), and a tripwire failing if
`serde_repr` appears among direct dependencies or as a derive/attribute in
`src/` without an adjacent `@ref` to the deciding document. **Covered
scope:** Rust-owned encodings plus what the artifact-schema drift gates
already pin for generated artifacts; client-side wire decoders and
hand-written SQL encodings are out of scope of the mechanical guard (the
standing rule still applies to them).

## Status

Accepted. Ratified 2026-07-02 by Charlie (decision drafted and applied by
Claude (Fable 5) under Charlie's same-day delegation). Ledgered in
[LLP 0000](./0000-snapback.explainer.md); docket row DK-7 closed in
[LLP 0032](./0032-decision-and-implementation-hardening.plan.md).
Implementation lands via LLP 0032 P2/P3.

**As-built (LLP 0032 P3(c), 2026-07-02).** The mechanism landed. The
Snapback-owned serde types carry `schemars::JsonSchema`; a single generator,
`snapback::schema_export::artifact_schemas`, is written to
`schemas/*.schema.json` by the `snapback-schemagen` bin and diffed by the drift
gate `tests/artifact_schemas_v0.rs` (`dk7_committed_schemas_match_rust_types`) —
one generator, two callers, so the committed files cannot diverge from the
checker. A representative value of each artifact round-trips through serde and
validates against its committed schema
(`dk7_representative_values_validate_against_committed_schemas`), confirming the
generated schema matches the actual serde representation. Most types need only
serde-compatible derives. Narrow Rust-owned `#[schemars(...)]` projections are
permitted when the runtime type is intentionally non-serializable—for example,
ENG-24596's zeroizing bearer/code wrappers project as JSON strings while manual
`Serialize` controls the only release seam. Raw serde tests reject duplicate
and unknown inbound fields, and schema fixtures validate the projected wire
shape, so the override does not become a second authority.

Committed artifacts now include schema/function/capability manifests,
diagnostics, inspect state (full and public projection), storage info, the
`hostOpsResult` and host-ready descriptors, and the closed auth request,
mailbox, credential, alarm, mint-session, and rescue DTOs listed in LLP 0057.
The host-ops envelope is no longer deferred: LLP 0024's first slice and
ENG-24596's auth operations both use the generated schema.
Each committed schema carries the Snapback schema version on its `$id`.
`demos/_kit/codegen.mjs` validates every Snapback-owned artifact it emits against
the committed schemas before writing, failing closed with a structured
`CODEGEN_ARTIFACT_SCHEMA_{MISSING,INVALID}` diagnostic (a dependency-free
structural check of the highest-value invariants — required properties,
`additionalProperties`, and the artifactKind/schemaVersion constants; the
exhaustive gate is the Rust round-trip). **P2 handoff:**
`schemas/capability.manifest.schema.json` (from `manifest::CapabilityManifest`)
is committed so P2 can delete the JS capability-manifest literal and consume the
schema half.
