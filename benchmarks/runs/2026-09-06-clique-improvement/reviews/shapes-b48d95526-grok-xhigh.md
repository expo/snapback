I'll run an independent source review of the Snapback2 nested named-shape collection fix against the stated contracts, starting with the review skill and LLP context.This is a snapshot source review, not the generic PR-review workflow. I’ll load the assignment constraints, LLP 1011, and the patch next.I’ll keep reading LLP 1011’s shape contracts and then the patch so the review is grounded in the actual change.The patch is small; next I’ll read the lowering, collection-mutation, and certifier paths that this binding change actually hits.**READY**

The nested named-shape collection fix is a precise lowering change: expanded sequence/page field bindings become an explicit spread copy instead of aliasing the mutable collector. True authored aliases still refuse. I did not find a material product defect with a changed-path repro.

## What changed

In `shapeObject`, a named-shape field that already carries `expandedFrom` still gets a diagnostic-site temporary, but a `sequence` or `page` value is now `[...collector]` rather than `collector`.

That matches LLP 1011’s nested-collection rule and LLP 1002’s collection-mutation ruling: mutation is allowed only on one locally allocated collection, with no alias before or after the mutation. The old lowering was:

```ts
const __q_rows_… = [];
for (...) __q_rows_….push(…);
const __q_shapeField_… = __q_rows_…; // identifier alias → E_OPAQUE
```

Inline shapes never hit this: they put the collector in the object after the last `push`, which LLP 1002 admits as escape-after-final-mutation. Only the expanded diagnostic-site binding created an alias. The copy is gated on `expandedFrom` and on `sequence`/`page` for that reason, not as a generated-name exemption.

## Review axes

**Hygiene / no generated-name exemption.** Temps remain `__q_${kind}_${line}_${col}_s${expansionId}`. Collection sharing still treats identifier assignment as an alias and object membership as an escape, with no `__q_` special case. The new compiler check authors those names in TypeScript and still refuses both the alias and the pre-mutation escape, with the ordinary `[...rows]` paste.

**Nested shape / record / page typing.** Point fields (`author`, `quoted`) stay scalar/object bindings. Collection fields from `emitPageShape` / `emitWalk` are `sequence`; unshaped scans stay `page` and `[...db.scan(…)]` is IR-identical to binding the scan. `pair` expands `messageCard` twice with distinct `expansionId`s. Imported `messageCard` still resolves `person`/`target` in the defining module.

**Mutation / loop isolation.** Each outer row redeclares the inner collector (`const rows = []` / IR `Const` of a new empty array). The spread is an array literal, so sharing analysis does not draw an alias edge; spread elements are not treated as escapes. After the copy, the original collector is not mutated. Engine and twin both clone on `Variable`, so later `Const rows = []` cannot refill a prior card’s `targets`.

**Deterministic cloning vs certifier/twin.** `[...bounded]` is the existing admitted copy form (`compiler.ts` / `expr.ts`). A single-element spread lowers to the operand (`Variable` or `Scan`), not a new IR spread node. That is not a hidden form: certifier already understands `Const` of `Variable`/`Scan`; both runtimes clone on variable read (`Value::clone` / JSON clone). Multi-segment spreads still become `Concat`. Authored `const a = b` remains refused, which is what prevents TS-alias vs IR-clone divergence.

**Worst-case bounds.** The extra statement was already the diagnostic-site `Const`; only the initializer changed. No extra scan is introduced, so examined/index/rule costs stay the nested-scan product the certifier already walks. Spread requires `staticBound`; page-shape collectors get that bound from the scan `take` and the loop’s one `push` per iteration. Output accounting does not double via `Concat` because this is a single-segment spread.

**Diagnostics stay authored.** The snapshot statement is marked with `field.site` (`// q:…` plus `/* q-use:… */`). Lowering refusals remap to the shape-field definition and the use site; the rewrite is the authored Quarry module, not generated TypeScript. The happy path no longer emits `E_OPAQUE` naming `__q_rows_…`.

**RBAC and selected-return cursor provenance.** Nested `Get`/`Scan`/`Exists` remain in the IR and still go through read rules. Certifier `origins()` only records a `Return` of `Page` origin; a one-to-one collector can carry a page out of its own loop, but a nested page sitting in an object field cannot. `history` → `messages`, `inbox` → `members`, `pair` → no result page. Twin replay of the fixture checks hidden `targets` (`reader ≠ viewer`), invisible `author` (`visible = false`), inbox `recent` length 1 per member, and history page-two length 1 (cursor did not follow `targets`).

## Non-blocking

`rustCheck(…, { examined: 10 })` is not a full `Ceilings` object (the Clique row-width test passes every field). A partial object fails request JSON parse, and `assert(tooSmall[0]?.error)` would still pass on that parse error. Even a valid `examined: 10` would refuse `last 20` alone, so this line does not uniquely prove nested reads hit the ceiling. Nested scans are still in the IR and still enter the existing examined walk. Not a product defect.

## Verdict

**READY.** No material issue, no changed-path repro.
