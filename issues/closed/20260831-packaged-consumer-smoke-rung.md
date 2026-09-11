# Packaged-consumer smoke rung missing from the snapback2 proof

**Status:** Closed

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

## Triage — 2026-09-11 (UTC)

**Disposition:** Closed — implemented. **Triage priority:** P3.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The missing consumer proof is implemented, not a remaining feature request. scripts/consumer-smoke.mjs packs/installs the shim and native/helper artifacts, then runs installed imports, both templates, check/dev/test and React round trip. measure.mjs invokes it; publication uses the production consumer proof.

LLP 1002 §11 documents the installed-consumer replacement. metrics/loop.jsonl at 2026-09-10T22:31:34.834Z, cc64186513, records consumer_smoke_s=13.06 with all invoked steps successful; the engine-less chat receipt remains explicitly blocked for engine absence, not a production effects pass. This closure concerns presence and execution of the consumer rung, not the whole loop budget or all-platform qualification.
