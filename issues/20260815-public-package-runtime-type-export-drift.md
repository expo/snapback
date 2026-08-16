# Two public runtime exports are missing from package declarations

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Public packages, Type declarations, Publication proof
**Date:** 2026-08-15
**Governing:** LLP 0041, LLP 0115
**Related:** `scripts/check-package-export-types.mjs`
**Found while:** Whole-codebase correctness review (2026-08-15)

## Problem

`bun run check:export-types` compiles the external-consumer fixture successfully
but fails runtime/declaration parity for two public subpaths:

```text
@expo/snapback-cli ./expo-dev:
  runtime exports missing from the declaration: expoBackendDevAuthEnvironment
@expo/snapback-codegen ./standard-patterns:
  runtime exports missing from the declaration: lowerDataResourceV1
```

Both functions are exported at runtime. TypeScript consumers cannot import them
through the declared public surface without falling out of the package's type
contract, and the publication qualification gate is red.

## Desired outcome

Either declare each runtime export with its exact public types, or make it
private/non-exported if it is only an internal seam. Do not silence the parity
checker.

## Acceptance

- `bun run check:export-types` passes.
- External TypeScript fixtures can import every intentionally public symbol.
- The package export maps and generated reference documentation agree with the
  chosen public/private status.

