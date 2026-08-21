# Stale diagnostics-registry projections on main (check-inventories guide-manifest red)

**Opened:** 2026-08-16
**Status:** Open
**Related:** guide/reference/diagnostics-registry.json, guide/reference/diagnostics.md, scripts/generate-diagnostics-registry.mjs, scripts/check-inventories.mjs

`node scripts/check-inventories.mjs` fails on current main:

```
[check-inventories] FAIL guide-manifest
[diagnostics-registry] stale: guide/reference/diagnostics-registry.json
[diagnostics-registry] stale: guide/reference/diagnostics.md
[diagnostics-registry] run node scripts/generate-diagnostics-registry.mjs
```

Observed 2026-08-16 ~00:55 in a full checkout (gitignored guide inputs present),
at local `bacd83fb4` + a coterie-only working delta that touches no `SNAPBACK_*`
code and no `guide/`, so the staleness is main content, not the coterie landing.
It was green earlier the same night at `438357bfb`, so the un-regenerated codes
landed in between; likeliest suspect is the `snapback init` composition landing
(`071ef3127`, LLP 0261) or a sibling in that window.

**Fix-forward:** on a checkout with the guide inputs present, run
`volta run --node 24.18.0 node scripts/generate-diagnostics-registry.mjs` then
`volta run --node 24.18.0 node scripts/generate-guide-manifest.mjs` and commit
both projections (new codes may also need `NON_DIAGNOSTIC_SNAPBACK_LITERALS`
classification in crates/snapback/src/server/tests.rs per the s5_d10 gate). Close this ticket
with the landing SHA.

**Resolved 2026-08-21:** regenerated both projections on a full checkout
(gitignored guide inputs present, rebuilt via `./scripts/check-generated-artifacts`)
and landed them as `f6eb89353`. No `NON_DIAGNOSTIC_SNAPBACK_LITERALS`
classification edits were needed — `check-inventories` passes clean:
312 package tests; 27 scripts tests; 30 demos; 468 publication leaves;
142 guide pages / 1684 snippets. Two operational notes: (1) the
symbol-registry parity stage of the reference-registry inventory is
Node-version-sensitive — under ambient Node 22 it misreports
`@expo/snapback-expo/app.plugin` / `config-plugin` `module.exports` parity
errors; run it under the pinned Node 24.18.0. (2) `generate-guide-manifest`
refuses until demo generated artifacts exist; `./scripts/check-generated-artifacts`
is the documented repair and worked.
