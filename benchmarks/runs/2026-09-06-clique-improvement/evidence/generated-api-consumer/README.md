# Generated API consumer type-safety investigation

The retained successful callback 13 output from the unchanged 0.0.16 SDK loses row type safety under the actual Expo customer configuration: `result.row.done` becomes error-derived `any`, accepts a number assignment, and leaves the negative assertion unused. Adding only `Column` and `RowOfColumns` imports restores `boolean` and a clean primary consumer result. The full original report records actual merged-module resolution and the limitations of the `IsAny` control.

Four programs ran exactly once on EPYC with the actual SDK and dependency graph. All processes completed, but the original primary consumer has TS2578; declaration-checking results are 16 diagnostics originally and 11 with the import counterfactual. Those 11 shared TS1038 errors remain a separate package-generation defect. No product repair or blanket declaration qualification is claimed here.

Selected original evidence is copied byte-for-byte; the report's original relative links refer to `/Users/ccheever/clique-improvement/revisions/generated-api-type-consumer-r1/astra`, not necessarily this selected copy. The complete dependency/source/module-resolution manifests and raw observations remain there. `copied-evidence.json` binds each selected copy. Both native and outer author exits were 0 with actual Astra xhigh identity; all original inputs remained unchanged.

The narrow import repair and real generated-consumer regression coverage are assigned separately. Frozen 0.0.17 publication artifacts are unchanged. Source equality across earlier releases is recorded in the original triage; it does not establish consumer executions on those other versions.
