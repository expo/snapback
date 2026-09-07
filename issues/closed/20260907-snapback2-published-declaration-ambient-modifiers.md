# Snapback2 published root declarations contain invalid ambient modifiers

Status: Resolved
Date: 2026-09-07
Scope: Snapback2 package declaration generation

The actual qualified 0.0.16 SDK produces 11 TS1038 diagnostics when the retained Expo consumer configuration is run with only `skipLibCheck` changed to false. These occur at `dist/index.d.ts` lines 336, 340, 342–344, 346, 359, 361, 363, 365 and 367. Every error reports a redundant `declare` modifier in an already ambient context. Both original and import-only generated-API consumers retain exactly these errors; they are separate from the missing `Column`/`RowOfColumns` bindings.

`mergeOfflineProtocolDeclarations()` in `snapback2/packages/snapback2/build.mjs` inserts `offlineDeclarations.trim()` unchanged before the closing brace of the ambient `snapback2` module copied from compiler/lib.d.ts. The emitted offline declarations contain `export declare class` and `export declare function` declarations. Their unchanged insertion accounts for the observed errors. Build declaration checking precedes this merge and uses `skipLibCheck: true`, so the current successful package build does not establish validity of the merged root declaration.

Evidence: [confirmed consumer investigation](../../benchmarks/runs/2026-09-06-clique-improvement/evidence/generated-api-consumer/README.md), including both complete declaration-checking diagnostic arrays. Original report/SDK/module manifests remain at the external paths bound by that evidence. Root inspected the merge function and actual emitted declarations after the four-program investigation; no additional consumer run was needed to locate the source mechanism.

Repair the ambient merge while preserving the standalone offline declaration exports and public types. Verify the actual built package in a consumer with declaration checking enabled, retain the existing original diagnostics as the baseline, and add affected regression coverage for generated class/function declarations. Do not solve this by suppressing library diagnostics in customer configuration. At filing, no fix or clean declaration result existed. The separate generated-API import repair and frozen 0.0.17 release remain independent.

## Resolution — 2026-09-07

Source candidate `367d263b8f44fda994397d5f8bb8b8110951d021` (integrated `d2cfbe386`) fixes only the ambient insertion and registers unfiltered actual-package consumers. Normal build and public/standalone/helper-source checks passed once; both independent reviews returned READY. [Scoped evidence](../../benchmarks/runs/2026-09-06-clique-improvement/evidence/published-declaration-repair/README.md). Source repair is complete; publication is pending. Historical 0.0.16 diagnostics and the already-published 0.0.17 artifacts remain unchanged.
