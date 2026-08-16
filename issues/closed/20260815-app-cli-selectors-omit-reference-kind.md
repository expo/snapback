# Packaged App CLI is broken by generated-reference kind enforcement

**Status:** Resolved
**Impact:** 4
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** App CLI, Client SDK, Generated references
**Date:** 2026-08-15
**Governing:** LLP 0238 (reference-kind admission), LLP 0062 (App CLI)
**Related:** `packages/snapback-app-cli/index.mjs:181-204`,
`packages/snapback-app-cli/package.test.mjs:147`
**Found while:** Whole-codebase correctness review (2026-08-15)

## Problem

`@expo/snapback-app-cli` loads the function kind from the artifact manifest,
but `functionSelector()` drops it:

```js
const functionSelector = (artifacts, fn) => (artifacts.generation === null
  ? fn.name
  : Object.freeze({ name: fn.name, expectedGeneration: artifacts.generation }));
```

The canonical client now correctly requires generated references to carry an
`artifactKind`/`kind`. Consequently the package's basic agent journey fails
before transport:

```text
SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH:
mutate received a missing generated reference kind
```

This is a product regression, not merely a stale assertion: every App CLI call
using a generation-bearing artifact selector takes this construction path.

## Desired outcome

Construct the same closed function-reference shape codegen publishes, including
`artifactKind: "functionReference"` and the canonical title-case function
`kind`, while retaining the generation identity. Keep bare-name behavior only
for the explicitly legacy/no-generation path.

## Acceptance

- The packaged App CLI mutation, query, action, and live-query journeys pass.
- Each generated selector carries the exact reference kind and generation.
- Deliberately mismatched verbs still refuse locally before transport.
- `bun run test` passes in `packages/snapback-app-cli`.

## Resolution (2026-08-15)

`packages/snapback-app-cli/index.mjs` now constructs a generation-bearing
function reference with `artifactKind: "functionReference"`, the canonical
title-case kind, the exact generation, and the loaded argument contract. The
legacy/no-generation path alone retains the bare function name.

`packages/snapback-app-cli/package.test.mjs` now covers Query, LiveQuery,
Mutation, and Action selector shapes and proves wrong invoke/subscribe pairings
refuse before the client transport is called.

Focused proof: `node package.test.mjs` in `packages/snapback-app-cli`.
Verbatim summary lines:

```text
package.test.mjs: packaged discover/pair/mutate/subscribe/verify journey passes
package.test.mjs: planted SNAPBACK_ADMIN_TOKEN never left the engine
package.test.mjs: every call family asserted the artifact generation
package.test.mjs: generated selectors preserve all four nominal reference kinds
```

The whole package command advances past this proof, then reaches an unrelated
base-commit auth assertion whose expected final calls omit the now-observed
`/auth/session` call. The test and its auth implementation are byte-identical
to base `a93a11235` (`fc26a25a…` and `68870dd4…` respectively); no auth files
were changed in this resolution.
