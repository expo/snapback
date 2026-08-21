# Add packed vertical contract fixtures for advertised authoring paths

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Guide, Public package exports, TypeScript, Code generation,
Handler runtime, React/headless clients, Authoring profiles, Diagnostics
**Governing:** LLP 0295 vertical paved-path coherence invariant and D0.3/W3;
LLP 0061; LLP 0252; LLP 0253; LLP 0275
**Related:** `issues/20260820-guide-gap-familiar-handler-dialect.md`;
`issues/20260820-familiar-vdoc-generation-runtime-parity.md`;
`issues/20260820-guide-gap-membership-roster-projection-recipe.md`

## Problem

Layer-local tests allow an advertised path to change meaning across the Guide,
public entrypoint, generated types, codegen, runtime validation, client hooks,
and diagnostics. The current Familiar page demonstrates the class directly:
nullable document/direct object result spellings and membership
`resourceField: "_id"` do not agree with current generated/runtime contracts,
while membership-backed ephemeral behavior exists below an entrypoint that
does not expose the needed constructor.

Fixing only the page, generator, or runtime can move the mismatch one boundary
downstream.

## Scope

- Provide a reusable packed-external-package fixture shape that starts from one
  first-read Guide spelling and checks its advertised import.
- Typecheck and generate it from a clean application in one pass.
- Run the generated artifact and assert the exact result, nullability,
  authority, and lifecycle contract through the relevant headless/framework
  client.
- Add one negative case whose earliest capable layer refuses with a stable
  diagnostic and one supported rewrite.
- Start with the confirmed Familiar cases: nullable point results, closed
  object/value results, document results, membership resource identity, and
  the profile's ephemeral export path.
- Add the fixture as an acceptance obligation to future fixes that change an
  advertised authoring path; do not turn internal lowering syntax into public
  contract.

## Exit

Every initial case has one packed vertical receipt covering Guide retrieval,
public import/typecheck, clean generation, runtime behavior, client projection,
and a negative diagnostic. Supported spellings agree at every layer;
unsupported spellings refuse before emitting artifacts that a later layer
rejects. The fixture is cheap enough for affected-scope use and does not
require the complete benchmark.
