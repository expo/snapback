# Packaged-consumer smoke rung missing from the snapback2 proof

**Opened:** 2026-08-31 · **Systems:** snapback2 packaging, dev loop, proof

The first-ever exercise of the packed artifacts as a consumer (npm install
of the two tarballs into a scratch app, in service of a diagnostic Clique
benchmark run) found two greens-in-repo/red-in-package defects on the very
first command:

1. `snapback2 init`/`check` refused every scaffold with `E_OPAQUE`
   duplicate-identifier conflicts: the project checker injects its ambient
   `declare module "snapback2"` lib AND resolved the app's bare
   `snapback2` imports to the installed shim's `dist/index.d.ts` — two
   conflicting ambient modules in one program. Fixed by pinning bare
   `snapback2*` specifiers to never resolve to files
   (`packages/compiler/src/project.ts`), plus a node_modules diagnostic
   filter.
2. The todos template's journey test failed its own `check`
   (`'before.data' is possibly 'undefined'`) — `init` did not scaffold
   green. Fixed in the template.

The existing suite has a pack-side test ("npm pack from a clean dist
builds every exported module") but no consumer-side rung. Wanted: a proof
step that packs both tarballs, installs them into a scratch dir, and runs
`init` → `check` → `test` green (candidate home: `scripts/test.sh` leg or
the publish path before `npm publish`). Until it exists, every publish
ships a surface no test has ever consumed.
