# snapback2 compiler: nested handler destructuring defaults compile and silently disappear from IR

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-31
**Related:** LLP 1002 §2, `snapback2/packages/compiler/src/compiler.ts:261`

Found by the round-4 blind review of the provenance lane; triaged INHERITED at
`ca7fa28d8` (identical behavior on main).

```ts
({ db, args: { key = "fallback" } }) => db.get(items.byKey, [key])
```

compiles: the IR carries only `Variable("key")` with `Arg` provenance and no
fallback — a missing optional argument behaves differently from the authored
program. `operationCompositeBindings` extracts binding names and never lowers
or refuses `BindingElement.initializer`. Related: the renamed nested form
`({ args: { key: renamed } })` refuses as unknown, so the default-carrying form
compiling is a name coincidence, not a supported surface.

Fix per the no-silent-states rule: nested handler patterns with defaults (and
generally non-identifier handler bindings) refuse with a sited envelope and a
rewrite (read the arg, apply the default in the body), the same way
`orderedPair` destructuring defaults now refuse (`E_OPAQUE`, closed in the
provenance lane's round 3). Alternatively lower defaults with their provenance
— but pick refusal unless the value model wants defaults, and record the
choice in LLP 1002 §2.
