# LLP 0246: TypeScript handler-module custody

**Type:** RFC
**Status:** Accepted
**Systems:** Authoring, TypeScript, Code generation, Runtime, Artifacts,
Diagnostics, Developer experience, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (author acceptance: Charlie Cheever accepted this RFC at
the exact revision bound by the final GPT-5.6 Sol round-3 READY artifacts,
SHA-256 `2b920d48abf970e813754c51451bc7d578daac9f70fc6d344a0cb98934e9625f`; see
`llp/reviews/0245-0249-single-family-super-refine.md`). 2026-08-12 (round-1 sibling-coherence revision: bounded type-only
checker nodes, added an exact generated editor project and `.mts` mapping
golden, and kept the package-aware LLP 0249 profile separate). 2026-08-12
(entered an author-invoked, single-family GPT-5.6 Sol
xhigh refinement loop; initial Draft owned the direct `.ts` custody boundary
explicitly deferred by LLP 0237)
**Related:** LLP 0009, LLP 0010, LLP 0037, LLP 0061, LLP 0093, LLP 0108,
LLP 0117, LLP 0123, LLP 0127, LLP 0140, LLP 0198, LLP 0203, LLP 0237,
LLP 0241, LLP 0245, LLP 0249

## Summary

Snapback should admit `.ts` and `.mts` definition/helper modules in the bounded
handler graph while preserving the exact portable runtime boundary of LLP 0237.
Codegen owns a pinned, syntax-erasing TypeScript transform, contextual handler
types, module resolution, source maps, and identity. The runtime continues to
execute admitted JavaScript bytes and contains no TypeScript compiler.

This RFC does not admit packages, Node built-ins, arbitrary project compiler
plugins, decorators, path aliases, or runtime type reflection.

## Motivation

Snapback already parses some TypeScript handler files and generates handler
context types, but LLP 0237's new multi-file custody path deliberately stops at
`.js`/`.mjs`. That means the ordinary refactoring a TypeScript author expects—
moving a typed helper into `lib/foo.ts`—crosses an unsupported boundary even
though the equivalent JavaScript graph is admitted.

The product should make the safe language boundary legible through editor and
compiler feedback, not require authors to choose between types and helper reuse.

## Constraints

- LLP 0237's graph bounds, relative-only resolution, top-level grammar,
  capability scan, and cross-target corpus remain unchanged.
- Frozen Snapback declarations, not inferred TypeScript return types, remain
  runtime and manifest authority (LLP 0108; LLP 0245).
- The exact compiler/transform/configuration and emitted bytes are artifact
  identity inputs (LLP 0241).
- Type erasure cannot become a path to decorators, custom transformers,
  `tsconfig` path aliases, package resolution, or ambient runtime APIs.
- Diagnostics and stack traces point to authored TypeScript.

## Decision

### D1. One closed TypeScript source profile

Add `bounded-handler-typescript-v1`, an additive source profile over LLP 0237's
runtime profile. Definition roots and literal relative imports may end in
`.ts`/`.mts` as well as `.js`/`.mjs`. Mixed graphs are permitted; every edge is
resolved by Snapback's canonical resolver. `.tsx`, `.cts`, declaration files,
bare/package imports, `node:`, project aliases, CommonJS, dynamic import, and
extension inference refuse in v1.

The authored operation remains inline beside args/result/auth/read/write/effect
declarations. A `.ts` extension never selects a broader runtime capability.
LLP 0237's file-count, import-depth, and source-byte bounds apply to the entire
checker closure, including type-only nodes; erasure does not create an
unbounded second graph.

### D2. Snapback owns the effective compiler configuration

The package pins the TypeScript package version and integrity plus a closed
effective option set: ESM output, syntax erasure, exact module semantics,
source maps, no emit-time helpers, no decorators, no JSX, and no custom plugin
or transformer. Codegen emits `handler-typescript-profile.v1.json` containing
that configuration and the diagnostic rule table.

Codegen also emits `.snapback/typescript/tsconfig.json` with the exact effective
options, generated declarations, and bounded checker file set. First-party
editor integrations select it, so ignored/refused application options cannot
leave the editor silently checking a different profile.

An application `tsconfig.json` may contribute editor-only strictness options
that do not change module resolution or output. Any output-affecting conflict is
ignored with a source-attributed diagnostic or refused when ignoring it would
make editor and build semantics materially disagree. The effective config is
always inspectable.

### D3. Generated types contextually type the handler interior

The authoring package exposes generated, operation-kind-specific builder types:

- args flow from the frozen validator declaration;
- `ctx.db` is typed from the generated schema and read/write capability split;
- generated refs type internal calls and schedules;
- `ctx.auth`, assets, effects, secrets, and refusal helpers reflect only
  declared capabilities; and
- the handler return is checked for assignability to the frozen result contract.

The checker consumes declarations and reports disagreement; it never mints or
widens them. LLP 0245 may separately propose a result block when one is absent.

### D4. Type-only and runtime edges are distinct

`import type` edges and erased type declarations participate in evidence and
checker identity and in D1's checker-graph bounds, but not the executable module
graph. A value import is a runtime edge and must satisfy LLP 0237 in full.
Codegen verifies after transform that no erased construct introduced an
undeclared helper, import, global, or capability.

Enums, namespaces, parameter properties, decorator metadata, `const enum`, and
other TypeScript forms whose output or cross-version semantics are not plain
syntax erasure refuse in v1. Authors use literal unions, objects, and ordinary
classes only where LLP 0237 independently admits their runtime form.

### D5. Identity binds source profile and output

The semantic operation identity binds the canonical runtime-relevant authored
AST, frozen declarations, normalized runtime graph, and source-profile version.
The executable identity additionally binds compiler package integrity,
effective options, transform version, and final JavaScript bytes. Type-only
changes rotate checker/evidence identity; they rotate semantic identity only
when they change a frozen declaration or admitted runtime graph.

No compiler upgrade can silently rewrite a current generation. Dual-transform
goldens must pass before the pinned version changes, and the new executable
identity follows LLP 0241's reload classification.

### D6. Source maps are first-party custody

Every diagnostic, stack frame, profile refusal, and conformance report maps to
the authored `.ts` span. Source maps are integrity-checked evidence artifacts
and never embedded with absolute checkout paths in runtime bytes. A mapping
failure refuses generation rather than reporting generated JavaScript as the
only actionable source.

## Compatibility and migration

Existing `.js`/`.mjs` graphs keep `bounded-handler-modules-v1`. Renaming a file
to `.ts` opts that operation into the new source profile and rotates the
appropriate identities. No runtime or target may claim TypeScript support until
its emitted JavaScript passes the existing Hermes/Workerd conformance corpus.
LLP 0249's package-aware action source profile is separately versioned and does
not reuse this package-free profile unchanged.

## Rollout

1. Freeze the closed syntax/option profile and emitted profile artifact.
2. Type-check existing single-file TypeScript definitions without changing
   emitted runtime bytes.
3. Add `.ts`/`.mts` relative helpers behind an app capability flag and prove
   mixed-graph resolution/source maps.
4. Add generated contextual types and frozen-result assignability checks.
5. Run the complete LLP 0237 adversarial graph corpus on emitted bytes for both
   targets.
6. Rerun a published-package Clique/CRUD pair using only TypeScript definition
   and helper files; measure editor-before-codegen corrections.

## Acceptance

- A query and mutation share one typed `.ts` helper without casts or duplicated
  domain logic and behave identically on Hermes and Workerd/V8.
- The editor types args, schema rows, ids, auth, generated refs, and result
  assignability from frozen declarations.
- Package imports, path aliases, output-affecting project transforms, decorators,
  and a value hidden behind `import type` refuse before artifact replacement.
- Compiler/config/output identity is inspectable and rotates on a pinned
  compiler change; a type-only comment/annotation change cannot silently rotate
  executable identity.
- Every negative diagnostic and runtime stack maps to the correct authored
  TypeScript span without an absolute path in executable bytes.
- `.mts` roots and helpers map import specifiers, emitted extensions, graph
  identity, and source-map spans identically across local and hosted goldens.
- A failed TypeScript candidate leaves the previous complete generation active.

## Risks

- Supporting “TypeScript” can imply the whole ecosystem. The source profile is
  intentionally much smaller than a normal Node build and must be named in
  errors and docs.
- Compiler upgrades can cause identity churn. Pinning, golden transforms, and
  LLP 0241 classifications make that explicit.
- Contextual types can become another generated-surface drift point. They must
  derive from the same Rust/codegen schemas and pass parity gates.

## Open questions

1. Should `.tsx` ever be admitted for pure helper modules, or remain an
   application-client concern permanently?
2. Which editor-only `tsconfig` strictness options may compose without making
   the effective build confusing?
3. Does the first release support `.ts` definition roots as well as helpers, or
   stage helpers after single-file parity?

## Status

Accepted. This RFC extends source custody only. It does not widen runtime
capabilities or make TypeScript inference authoritative. Accepted by the author
on 2026-08-12 at the revision bound by the final single-family GPT-5.6 Sol
READY review.
