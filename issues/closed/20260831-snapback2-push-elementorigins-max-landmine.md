# snapback2: `array.push` updates IR contents but not cardinality or element origins — Fanout is the only thing preventing a provenance lie

**Status:** Resolved
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

**Claimed:** 2026-08-31 by session snapback-8a [f8c2a2] — lane `s2/t2-tails` (worktree `~/projects/snapback-s2v`) takes this ticket together with the push-elementorigins ticket (same files); other sessions should skip both.

## Resolution (2026-08-31)

Resolved in `54e9a7968`. Every `array.push` element now goes through one
`updateArrayBindingAfterPush` operation that appends its bind-time origin and,
when the push count is statically countable, increments the same binding's
maximum. Straight-line multi-argument push therefore lowers every authored
element and produces `initial max + pushed element count`; a one-element array
plus two pushed operation arguments lowers with max `3` and certifies `Arg`.
Pushes inside a loop keep the conservative Fanout-bound lane (no newly claimed
loop-multiplied maximum), but still update origins through that same operation.

The regression pin iterates a spread of the pushed array. Same-origin pushes
compile and certify; an `Arg` initial element followed by a `Viewer` push
refuses with `E_PROVENANCE_AMBIGUOUS` and a non-lowerable rewrite naming both
`args.key` and `ctx.viewer`. A future bound widening that omits origin updates
will make this test fail instead of silently producing an `Arg` certificate.
Corpus regeneration wrote 81 frozen cases with no byte changes.

**Closed 2026-08-31** (session snapback-8a, lane `s2/t2-tails`): push origin updates and bound growth are coupled in the collection-facts choke point; blind widening refuses; nested/branch mutation deltas compose multiplicatively or by arm-max; self-growing domains refuse E_UNBOUND_LOOP at every depth; escape-closed aliasing prevents the copy-semantics divergence this landmine guarded. The Fanout coincidence is replaced by proven bounds (reviewer-probed: no shape with runtime length > certified max).
