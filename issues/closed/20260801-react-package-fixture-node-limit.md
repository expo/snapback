# packages/snapback-react/package.test.mjs fails on origin/main: fixture args exceed the canonical node limit

**Status:** CLOSED — pre-existing upstream red, verified on CLEAN
origin/main (f119088e-era tip) during the ceremony-floor landing:
`git stash` → `node packages/snapback-react/package.test.mjs` → exit 1,
`SNAPBACK_REACT_ARGS_INVALID: value exceeds the node limit` at
`$.functions.functions[141].resultContract.record.fields[0].name`
(nodes 4097 > 4096).

The test's 263-function fixture manifest, canonicalized as query args by
the binding harness, crossed the 4096-node canonical-value limit — most
likely a recent landing grew per-function manifest entries (candidates:
the 0100 M2 pagination members or the 0144/ctx.refuse declarations).
Not caused by the asset ceremony work (bisect evidence above). Owner:
whoever grew the manifest entry — either shrink the fixture, stop
canonicalizing whole manifests as args in the harness, or revisit the
limit deliberately. The rest of the react chain (assets, optimistic,
lifecycle, etc.) passes individually.

## Resolution

Fixed 2026-08-01 at the boundary that caused the false refusal. A complete
generated manifest is deployment metadata, not React query arguments, so the
binding-receipt digest no longer subjects the whole manifest to
`CanonicalClientValueV1`'s 4,096-node store-key budget. It retains the same
getter-free canonicalizer under a separate finite artifact profile (65,536
nodes, with explicit depth/field/array/string/total-byte ceilings). Query args
and React store identities keep their original 4,096-node contract unchanged.

The existing 263-function capacity fixture now crosses the old boundary while
preparing and digesting the full manifest successfully. The focused package
test and the complete `@expo/snapback-react` suite, including strict TypeScript
fixtures, pass.
