# packages/snapback-react/package.test.mjs fails on origin/main: fixture args exceed the canonical node limit

**Status:** OPEN — pre-existing upstream red, verified on CLEAN
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
