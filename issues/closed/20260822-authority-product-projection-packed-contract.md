# Prove the authority projection through a packed external consumer

**Status:** Closed — 2026-08-22
**Opened:** 2026-08-22
**Systems:** Code generation, package publication, generated client contract
**Governing:** LLP 0240 D0.4; LLP 0295 vertical paved-path coherence invariant
**Related:** `issues/closed/20260822-authority-product-projection-writer-runtime.md`

## Scope

Add an external-consumer fixture that installs packed publication artifacts
and proves the documented authority projection spelling through generated
manifest, runtime handler source, and TypeScript client contract.

## Acceptance

- The fixture consumes packed packages rather than workspace source imports.
- Explicit and Familiar schemas accept the same projection declaration shape,
  with each profile's exact generated operation identity bound at the sink.
- Generated history/incarnation APIs expose D1 cursor nullability and the
  additive history-horizon fact while `list` remains compatible.
- The exact recipient sink marker is present only on the declared sending
  mutation, and the helper returns `Promise<null>` rather than principals.
- One invalid non-full-provenance declaration fails with a stable diagnostic.

## Resolution

`packages/snapback-codegen/authority-projection-packed.test.mjs` packs the
codegen and contract packages into an isolated consumer, generates both
profiles, checks the manifest and emitted handlers, compiles both Explicit and
Familiar public TypeScript shapes, and exercises the negative diagnostic.
