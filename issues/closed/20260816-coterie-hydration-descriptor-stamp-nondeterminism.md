# Coterie hydration-descriptor stamp is build-nondeterministic (last-build-wins)

**Opened:** 2026-08-16
**Status:** Closed
**Source:** Coterie slice-1 landing (LLP 0266; commits e548ae9dd/a3e61b9c4)

## Observation

`demos/coterie/public/__exact/hydration-build-descriptors.json` is a
committed file rewritten by every `bun run build` (exact-vite-plugin stamps
a sha256). Three consecutive builds of identical inputs during the slice-1
landing produced three different stamps:

- `5c613d4867…` (lane build)
- `23b798d46a…` (orchestrator re-verify, no intervening edits)
- `0a50cc199a…` / `35318839ea…` (fix-round builds)

So the committed bytes are just whichever build ran last, and any two
checkouts that both run `build` will show spurious diffs in this file.
`verify:coterie` does not gate on descriptor freshness, so nothing is red —
but the file cannot serve as drift evidence, and it adds noise to every
landing that runs a build.

## Ask

Either make the stamp deterministic for identical inputs (preferred —
likely a timestamp or unordered-input hash in exact-vite-plugin, i.e. an
Exact-side fix; Coterie does not patch the linked checkout), or stop
committing the descriptor file and generate it at build time like the
other ignored build outputs. If the Exact-side route is taken, this ticket
graduates to the Exact repo and closes here with a pointer.

## Resolution (2026-08-17)

Chose the generated-output route and stopped tracking Coterie's sidecar.
`demos/coterie/.gitignore` now ignores only
`/public/__exact/hydration-build-descriptors.json`; the same committed pattern
under `demos/partiful-matrix` is intentionally unchanged and should be
evaluated separately.

Consuming-flow evidence:

- Coterie's `dev` and `build` scripts both run `generate:routes` before Vite,
  and `typecheck` does as well.
- Exact's linked `exactVitePlugin` independently calls
  `generateRouteRegistriesForApp()` from `buildStart` and regenerates after
  route edits in the dev watcher. The generator writes the source sidecar at
  `public/__exact/hydration-build-descriptors.json` with placeholder
  fingerprints.
- Vite dev serves that generated public asset. Vite build copies it into the
  output directory, then the plugin's `closeBundle` hook calls
  `stampStaticExportHydrationDescriptors(outDir)` and stamps the copied output,
  not the committed source bytes.
- A Coterie-tree search found no test or source consumer of the committed
  source path. The served and built consumers therefore always sit behind a
  regeneration step; a fresh checkout does not need the committed bytes.

The remaining cross-project determinism question belongs to Exact's
`packages/exact-devtools/src/vite-plugin.ts` `closeBundle` hook and
`packages/exact-server/src/artifact.ts`
`stampStaticExportHydrationDescriptors()`. The upstream design/history pointer
is Exact
`issues/closed/20260730-web-export-ships-unstamped-hydration-descriptors.md`,
which introduced that stamping boundary and its idempotence requirement. This
lane kept the linked Exact checkout read-only, so it did not create or modify
an Exact filesystem ticket.
