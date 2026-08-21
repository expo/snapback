# client-lifecycle vocabulary test red on main: T:rebuildTodos reference missing from api.d.ts

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Code generation, Client lifecycle, Testing
**Date:** 2026-08-16

`packages/snapback-codegen/client-lifecycle.test.mjs` ("manifest vocabulary,
generated types, and JSDoc share one lifecycle projection") fails on main:
the test backend's `rebuildTodos = defineAction(...)` appears in the
generated `client-lifecycle.v1.json` operations but the generated `api.d.ts`
no longer carries its ``reference `T:rebuildTodos` `` JSDoc block, so the
manifest/types projection no longer agrees for actions.

Baseline-proven inherited: reproduced with origin/main's own
`packages/snapback-codegen` checkout (pre-LLP-0258-Phase-3 content) inside a
fully installed worktree — the exact `AssertionError: T:rebuildTodos` at the
`assert.notEqual(start, -1, …)` vocabulary loop. Suspect window: the
2026-08-15/16 codegen landings between `32f902a09` and `35bc3cd82..main`
(media-command / bounded-media / visibility-composition wave rotated all
generated artifacts). The LLP 0258 Phase 3 D9 landing regenerates on top and
inherits the red unchanged.

Fix-forward: restore action reference emission in `api.d.ts` (or, if actions
were deliberately dropped from the reference vocabulary, update the manifest
emitter and this test together), then re-run the vocabulary test.

## Resolution — 2026-08-17 (backlog sweep)

Action reference emission is back on the generated type surface. Current
backends project Action JSDoc as `Action reference \`<app>:<name>\``
(semantic identity, not the old `T:` prefix);
`packages/snapback-codegen/client-lifecycle.test.mjs` still fails closed if
an Action identity is missing. The original `T:rebuildTodos` / `api.d.ts`
disagreement no longer describes the tree.
