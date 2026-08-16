# Packaged App CLI is broken by generated-reference kind enforcement

**Status:** Open
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

