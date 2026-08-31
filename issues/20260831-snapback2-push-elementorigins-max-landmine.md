# snapback2: `array.push` updates IR contents but not cardinality or element origins — Fanout is the only thing preventing a provenance lie

**Status:** Open
**Systems:** snapback2, compiler, engine
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-31
**Related:** `snapback2/packages/compiler/src/compiler.ts:444-448`, `snapback2/packages/compiler/src/lower/expr.ts:183-191`, `snapback2/crates/snapback2/src/…/runner.rs` (Fanout on `values.len() > max`)

Found by the round-4 blind review of the provenance lane; pre-existing
push/bound gap (not a lane regression).

```ts
const keys = [args.key];
keys.push(ctx.viewer);
for (const key of keys) found.push(db.get(items.byKey, [key]));
```

The compiler emits `provenance: "Arg"` and the certificate says
`prefix_template: Arg`, while the IR pushes a `Viewer` value into the domain.
Today this is NOT exploitable: `DerivedArray.max` stays 1 and the engine
Fanouts when `values.len() > max`, so the Viewer key is never successfully
read under the Arg certificate. But the guard is coincidental —
`collectionMutationCounts` tracks only `Map.set`/`Set.add`. If a future bound
fix teaches `push` to update `max` without also updating `elementOrigins`,
this becomes a silent Arg/Viewer certificate lie.

Fix: `push` must update `elementOrigins` (per-element classification, refusing
mixed origins like the literal-array path does) in the same change that ever
updates `max` — couple them in one function so they cannot drift, and add a
test that pins today's Fanout behavior so any future bound change trips it.
