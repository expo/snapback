# Two public runtime exports are missing from package declarations

**Status:** Resolved
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

## Resolution (2026-08-15)

The runtime seams remain public. `packages/snapback-cli/expo-dev.d.mts` now
declares `expoBackendDevAuthEnvironment` with its nullable/optional environment
input and numeric Metro port. `packages/snapback-codegen/standard-patterns.d.ts`
now declares the exact owner and public-read overloads for
`lowerDataResourceV1`, including their operation-set and list-index result.

Proof: `bun run check:export-types` from the repository root. Verbatim summary
lines:

```text
[check-package-export-types] fixture compile ok: 116 subpaths across 13 packages
[check-package-export-types] runtime parity ok: 116 declaration surfaces match their modules
[check-package-export-types] ok: every published subpath resolves TypeScript declarations under the `types` condition
```
