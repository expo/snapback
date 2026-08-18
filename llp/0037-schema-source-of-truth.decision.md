# LLP 0037: Schema source of truth — Rust types, generated JSON Schema

**Type:** Decision
**Status:** Accepted
**Systems:** API, Tooling, Client integration, Contract/Exact, Testing, Packaging
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-02
**Revised:** 2026-08-07 (AgentSafe declaration projection hardening: the hand-authored `packages/snapback-codegen/index.d.mts` AgentSafe block is now structurally compared with all four committed Rust-generated schema projections by a Node-only gate, invoked directly and from the DK-7 Rust drift test. The two artifact-local `EffectSettlementCapabilityV1` definitions are documented as separate `$defs` namespaces rather than one repository-global type.)
**Revised:** 2026-07-31 (LLP 0044 companion: the asset upload-intent
reference, attempt/transfer/lifecycle/receipt DTOs, and `SNAPBACK_ASSET_*`
detail shapes are Rust-owned under this decision, registered through
`schema_export::artifact_schemas()` with the ordinary drift gates; no
`ExpectedOperationV1` revival); 2026-07-27 (LLP 0108 amendment: Rust owns the effective result
contract and hashes projected through manifests, schemas, providers, Contract,
and generated references); 2026-07-23 (LLP 0086 CC-8 rows 1/7/11: schema lockdown recorded as a named safety feature; Triplit compatibility-classified schema-push comparison; Cambria lens-migration prior-art note); 2026-07-16 (ENG-24920 companion amendment); 2026-07-13 (ENG-24596: recorded narrow Rust-owned schema projections for non-serializable secret wrappers and the shipped host-ops/readiness/auth DTO schemas); 2026-07-02 (ratified same day: Rust-first; DK-7 decided)
**Related:** LLP 0004, LLP 0012, LLP 0016, LLP 0020, LLP 0024, LLP 0032, LLP 0044, LLP 0057, LLP 0082, LLP 0084, LLP 0085, LLP 0086, LLP 0108

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
  (`crates/snapback/src/manifest.rs`: `SchemaManifest`, `TableManifest`, `FieldManifest`,
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

*(2026-07-23, LLP 0079 SC-3; ratified by Charlie as an amendment to this
Accepted decision.)*

No Snapback-owned persisted or wire encoding may depend on declaration order
surviving edits. Enum-like values, fields, columns, and variant tags remain
name-keyed; a future by-index encoding requires an explicit recorded decision.
LLP 0078 F2c records the motivating corruption history in Serverpod.

`crates/snapback/tests/name_keying_guard.rs` pins representative Rust-owned unit and
data-bearing encodings and rejects an unreferenced `serde_repr` dependency or
derive in `crates/snapback/src/`. The standing rule also applies beyond the mechanical guard,
including client decoders and handwritten SQL encodings.

## Dated amendments: prior-art absorptions (2026-07-23)

Recorded per [LLP 0086](./0086-prior-art-course-corrections.plan.md) §CC-8
(rows 1, 7, 11). Row 1 is decision-bearing and follows this document's
dated-amendment convention; rows 7 and 11 record comparisons and prior art
without changing the decision.

**Schema lockdown as a named safety feature (CC-8 row 1,
decision-bearing).** InstantDB's `attrs` create-rules let an operator forbid
dynamic attribute creation — "schema lockdown against rogue agents"
(LLP 0082 §Permissions). Snapback's schema surface must support the
equivalent as a *named* lockdown mode: when engaged, no agent or client path
may create tables, fields, or indexes outside the declared,
manifest-validated schema. Under this document's Rust-first mechanism the
guarantee is today largely structural — the server's serde parsing fails
closed on undeclared shapes, and there is no dynamic-attribute path on the
paved surface — but recording it as a named feature rather than a side
effect means any future surface that can change schema (in particular a
provisioning push-schema operation) must preserve and expose it explicitly.
The operating-surface half — the lockdown *toggle* an operator or agent
harness sets — is carried by LLP 0086 §CC-1's provisioning surface spec
(LLP 0089, in drafting), which is required to expose it; LLP 0024 receives
its half through that spec.

**Comparison: Triplit's compatibility-classified schema pushes (CC-8
row 7).** Triplit classifies each schema push as backwards-compatible or
not, with an enforcement flag, and deployed clients *refuse to connect* on
an incompatible schema (LLP 0084 §Triplit). What LLP 0037 already covers:
one authoritative source per shape, generated schemas with a
`schemaVersion` on each artifact, a CI drift gate, and consumers that
validate what they read — so an incompatible artifact is caught as a
reviewable diff before it ships, and a fail-closed parse afterward. What
the classification idea adds that LLP 0037 does not have: a *runtime*
compatibility verdict at the deployed-client seam — the drift gate runs
between in-repo artifacts at build time and does not classify whether an
already-deployed client remains compatible with a newly pushed schema, nor
give that client a principled refuse-to-connect behavior distinct from a
generic validation failure. Recorded as a comparison only; no decision is
taken here beyond noting the gap for whichever document owns deployed-client
schema evolution.

**Prior art: Cambria-style lens migrations (CC-8 row 11).** Jazz v2 ships
Cambria-style bidirectional schema lenses for migrations — translating
reads and writes between schema versions so deployed clients on different
versions interoperate without lockstep upgrade (LLP 0085 §Jazz v2). Noted
as prior art for schema evolution across deployed clients — a pointer, not
an adoption; it complements rather than replaces this document's
single-source-plus-drift-gate shape.

## Dated alignment: effective result-contract custody (2026-07-27)

LLP 0108 extends the Rust-owned function-manifest authority with handler form,
implementation/argument/result hashes, and the closed recursive effective
result contract, including `LegacyQueryRowsV0`. Table-named document contracts
are expanded against the installed schema before hashing; downstream tools
must not hash or validate the unexpanded author shorthand.

Generated JSON Schema, TypeScript references, provider introspection, Contract
bindings, operation summaries, and capability inspection are projections of
that authority. Each projection carries the effective result hash. A consumer
that cannot represent a contract emits a closed missing witness or refuses; it
must not infer, drop, or widen fields. Executable source and source locations
remain outside public projections.

## Dated alignment: asset subsystem artifacts (2026-07-31)

Recorded as part of [LLP 0044](./0044-asset-storage-pipeline.rfc.md)'s
gating companion pass (directed by Charlie, 2026-07-31). LLP 0044's
carriers are Rust-owned serde/schemars types under this decision:

- the **upload-intent reference** — `artifactKind:
  "assetUploadReference"`, following the shipped `functionReference`
  whole-artifact idiom (`schemaVersion`, `appId`, `id`, `name`,
  `implementationHash`, `argsContractHash`, argument schema) plus the
  policy identity that freezes what admission means: an
  `intentPolicyHash` over the declared accept/delivery/access/processing
  facts and the intent policy generation. It deliberately carries no
  `ExpectedOperationV1` member — that carrier stays removed (LLP 0108
  §B) — and is name-keyed per the 2026-07-23 constraint;
- the upload attempt/task state machine DTOs, create/resume/cancel/
  finalize request-response DTOs, TUS-lane and S3-lane transfer
  instructions, live lifecycle messages, receipts, capability facts, and
  `SNAPBACK_ASSET_*` diagnostic detail shapes.

`snapback-schemagen` emits their committed schemas through
`schema_export::artifact_schemas()`, and the ordinary artifact-schema
drift and representative-value gates cover them, exactly as the
versioned-seed alignment above. Codegen owns only canonical construction
of authoring-surface artifacts; it cannot redefine a server request,
receipt, or reference. Generated SDKs in every language consume the same
committed schemas; none parses JavaScript source or synthesizes reference
identity. These types land with LLP 0044's first implementation slice —
this alignment freezes their shapes and custody, and LLP 0044 bars any
implementation from landing against different encodings.

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
gate `crates/snapback/tests/artifact_schemas_v0.rs` (`dk7_committed_schemas_match_rust_types`) —
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

**Versioned-seed alignment (2026-07-27).** LLP 0109's artifact, identity,
expected-stream, matched-observation, ensure-result, install/reset/preview
request, preview-result, and receipt carriers are Rust-owned serde/schemars
types. `snapback-schemagen` emits their committed schemas, and the ordinary
artifact-schema drift and representative-value gates cover them. Codegen owns
only canonical construction of `seed.artifact.json`; it cannot redefine a
server request or receipt.

**AgentSafe declaration projection alignment (2026-08-07).** The public
`packages/snapback-codegen/index.d.mts` declarations remain a projection, not a
second authority. `scripts/check-agent-safe-publication.mjs` compares the
complete `AgentSafe*` definition inventory, every enum value, and every object
property/reference against the identical AgentSafe definitions in the
capability-manifest and three inspect schemas. The Node-only gate runs in the
ordinary publication proof and is also invoked by
`dk7_committed_schemas_match_rust_types`, closing the Rust → committed-schema →
TypeScript-declaration chain without requiring schemagen for the final leg.

JSON Schema `$defs` names are artifact-local. The commit-envelope artifact's
five-value `EffectSettlementCapabilityV1` and the promotion-effect-intent
artifact's three-value type of the same name are therefore not one merged
schema definition. The DK-7 checker documents and compares those artifacts
independently. A future repository-wide schema namespace would require a rename
or qualified-name rule; this alignment does not invent one retroactively.
