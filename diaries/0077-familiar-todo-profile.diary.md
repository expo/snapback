# Diary 0077: familiar todo profile

**Date:** 2026-08-13
**App:** `tests/fixtures/familiar-todo`
**Systems:** Snapback familiar TypeScript authoring, codegen, inline handlers,
generated references, normalized definitions

## What I built

I authored the same three-operation todo backend twice. The familiar version
uses `schema.ts`, `todos.ts`, `query`/`mutation`/`action`, callback-style
`withIndex`, and `api.todos.create`; the explicit twin uses `schema.mjs`,
`functions.mjs`, the canonical constructors, and ES2022 string export names
such as `"todos.list"`. Codegen proves that the intended-equal schema and
operation facts have equal normalized contract and schema identities while
the two authoring profiles retain distinct semantic and generation identities.

## What felt good

- The generated `_generated/server` bootstrap made a clean familiar directory
  self-starting. Both schema and function modules use the learned local import
  without first checking in generated files.
- Module-to-namespace naming is predictable: `todos.ts` plus `list` becomes
  `todos.list` everywhere and `api.todos.list` at the familiar call site.
- Reusing canonical validators, auth values, result contracts, function
  manifests, and handler lifting kept the adapter small. The normalized witness
  made equivalence testable instead of relying on a visual comparison.
- Callback `withIndex` translated cleanly once the recorder represented one
  real chain. The adversarial range test demonstrated that no owner/range
  predicate disappeared during replay.

## What felt bad or surprising

- Canonical query results are list-shaped, so the familiar Convex-style
  `get` shape (`doc | null`) cannot lower exactly. The honest refusal and route
  to a zero-or-one document array are clear, but this is real familiar-lane
  friction.
- The action surface needed a positive facade rather than a wrapper over the
  canonical context. That is more generated code, but it makes the absence of
  database, jobs, realtime, stream, push, and arbitrary host effects
  mechanically inspectable.
- A content digest alone does not make a generated API marker nominal: a
  caller can reconstruct an identical frozen object. A per-handler `WeakSet`
  of markers created by the rewritten captured expression was required so raw
  strings and foreign lookalikes actually refuse.
- Dotted operation names reached more emitters than the main API object:
  Contract bindings, declarations, app aliases, inline attribution, and
  string re-exports all needed the same naming audit and collision fence.

The guide previously explained the profile custody value but not how to author
or diagnose the familiar layout. This change extends
`guide/getting-started/generated-artifacts.md` with the complete layout,
lowering boundaries, generated modules, and every Phase B refusal route, so no
separate guide-gap ticket remains open for the friction observed here.

## Comparison

Compared with React plus Convex, the familiar source reads naturally: one
TypeScript schema, module-namespaced functions, `v.*` contracts, live queries
by default, and generated `api.module.operation` references. Snapback asks for
more explicit auth and read/write declarations, and it refuses scalar query
returns and effectful familiar actions; those costs buy reviewable authority
and effect facts rather than inferred behavior.

Compared with Supabase, there is no separate SQL migration/RLS/realtime setup
for this fixture. Schema, handler contracts, live delivery, and generated
references stay in one code-generated graph. The tradeoff is that the familiar
profile is a deliberately bounded adapter, not a second backend language.

Exact/Contract was only a generated-output consumer in this proof. The dotted
name sweep had to keep its binding modules valid, but the fixture did not use
Exact authoring or UI behavior, so no ergonomics claim about Exact follows.

## Verification shape

- Golden success/refusal rows for familiar `returns` lowering
- Dual-profile normalized identity equality and semantic/generation separation
- Dotted-name syntax sweep across generated JavaScript and TypeScript
- Auth, reach, secrets, plan-vs-handler, and delivery divergence
- No-drop `withIndex`, non-chained refusal, exact frozen action facade
- Generated-marker acceptance plus string/foreign-marker refusal
- Familiar declaration suggestion generation and addition-only application
