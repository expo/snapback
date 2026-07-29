# Partiful / Snapback deep arm

Frozen protocol: LLP 0102, aggregate
`ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`.
Product/source commit:
`5f31cb6174daaefa04a1e05242acbbc22c725040`.

This arm uses the canonical local Ibex + SQLite target in session mode. The
runtime database, config, keyring, startup carrier, persona custody, provider
state, and listeners are arm-owned and removed by the acceptance suite.

Reproduce from the repository root:

```sh
scripts/bootstrap-ibex-runtime
bun install --frozen-lockfile
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs \
  demos/backend-bakeoff/arms/partiful/snapback/work/snapback
node demos/backend-bakeoff/arms/partiful/snapback/work/tests/acceptance.mjs
node demos/backend-bakeoff/arms/partiful/snapback/work/tests/build-performance.mjs
node demos/backend-bakeoff/arms/partiful/snapback/work/tests/finalize-capsule.mjs
node demos/backend-bakeoff/scripts/run-capsule.mjs verify \
  demos/backend-bakeoff/arms/partiful/snapback/run-capsule.v1.json
```

The final result is 12 passes and three explicit GAPs:

- authenticated event assets;
- an honestly complete hosted deployment/auth profile; and
- the complete frozen performance scenario, because its required asset sample
  cannot be produced.

No Stop-class defect was observed. The React shell is a public-preview surface;
the machine acceptance evidence, not the rendering, proves backend facts.
