# Codegen: `__proto__`/`constructor` and `${name}Publish` aliases silently corrupt emitted artifacts

**Opened:** 2026-08-08 · **Severity:** P2 (silent artifact corruption in a system whose premise is closed, verified generated code) · **Area:** snapback-codegen

Two instances of the same root cause: name-safety is enforced by many
individual call sites instead of one reserved-name / safe-embed choke-point, so
adversarial-but-valid authored names slip through.

## A) `__proto__` as a function name corrupts JS object literals

`packages/snapback-codegen/index.mjs:836` (`RESERVED_WORDS`), emit sites ~10243
and ~9272-9273.

`RESERVED_WORDS` omits `__proto__` / `constructor` / `prototype`; `IDENT`
admits them. Emission writes name-keyed maps as JS object literals
(`const actionReferences = ${stableJson(actionReferences)}`,
`Object.freeze(${stableJson(descriptors)})`). An Action exported as `__proto__`
passes validation; in the emitted `api.mjs` the key `"__proto__"` becomes a
prototype assignment, so the reference silently vanishes from the generated
`api` surface with no diagnostic. Same mechanism corrupts `micro.mjs`
descriptors. JSON manifests and null-proto maps are unaffected.

**Fix:** add `__proto__`/`constructor`/`prototype` to `RESERVED_WORDS`, or emit
embedded maps via `JSON.parse('…')` through one `emitEmbeddedObject()` helper.

## B) `${name}Publish` ephemeral alias has no collision guard

`packages/snapback-codegen/index.mjs:3515-3521` (guard), alias emission ~10849,
11024, 11048.

The ephemeral collision check covers only the bare collection name, but codegen
also mints `${collection.name}Publish` into `runtime-links.ts`, a
`foo.publish.ts` export, and a `fooPublish:` contract-meta descriptor. An app
with collection `foo` and a mutation `fooPublish` generates with no diagnostic;
two contract-meta modules then declare symbol `fooPublish` and `runtime-links.ts`
gets duplicate members — a downstream compiler conflict at best, the wrong
operation invoked at worst.

**Fix:** extend `EPHEMERAL_NAME_COLLISION` to also reject
`contract{Queries,Mutations}[name + 'Publish']` and cross-collection alias
collisions.

## Confidence

High on both mechanisms (no `__proto__` guard anywhere in index.mjs; the
`Publish` alias has no collision check). Medium on worst-case runtime behavior.
Both are latent (require adversarial-but-legal authored names) — worth closing
because the whole codegen design leans on emitted artifacts being trustworthy.

## Resolution (2026-08-08)
Fixed on main (Lane F). Verified: node --check all edited files; node --test 6/6; focused behavioral probes; ref-check clean.
