# Lane B W5 cherry-pick conflict resolution

Pristine inputs inspected before resolution:

- current main base: `3c6da75179d96abadde2ccb1ce24588df4d2b74a` (`HEAD`)
- lane B W5 commit: `111ac41dc2f446573ab7e6bb962efcd7a19bd553`
- lane B wave base: `5cae72b2b554e6ca9e5ce53e017bc5989e2ac8aa` (`111ac41dc^`)

## `packages/snapback-client/index.mjs`

1. **Recorder/helper insertion collision near `#requireOfflineMutationReplayCapability`.** Main's complete `#runtimeCostOwnershipTuple` body was restored as its own method, unchanged from the pristine main version. Lane B's `#recordMutationPhaseCost`, covering-delivery observer, restored-record scan, and `mutationPhaseCostInspection` were then retained as separate sibling methods. This avoids nesting lane B's methods inside main's ownership helper, which the collapsed marker context falsely suggested.

2. **Ownership construction at the start of `localResourceInspection`.** Main's internal `#runtimeCostOwnershipTuple` and `#runtimeCostOwnershipIdentityTuple` remain the source of the exact sharing/duplicate-subscription identity. The shared inspection function passes that internal tuple through lane B's `projectOwnershipTupleInspectionV1`, so the gated inspection keeps lane B's pseudonymized app/storage fields, `serverInstance: "self"`, and authority class without exposing main's raw server origin. The function also retains main's `runtimeCostDiagnostics` snapshot and lane B's mutation-phase costs, delivery fields, and pseudonymized connection identifiers.

3. **`liveQuery` owner-label option.** Main's `__frameworkOwnerLabel` convention won. Lane B's `__ownerLabelFrameworkAssigned` option was dropped because the framework/caller distinction is already represented by the mutually exclusive `ownerLabel` and `__frameworkOwnerLabel` inputs.

4. **`liveQuery` owner-label validation.** Main's validation of `__frameworkOwnerLabel` and its exactly-one-provenance check were retained. Lane B's boolean-flag validation was removed with the redundant flag.

5. **Live-query inspection registration.** Main's `inspectedOwnerLabel` calculation won: framework labels remain verbatim, caller labels are hashed once, and the headless fallback remains framework-generated. Lane B's inspection consumer was adapted to read that already-safe stored label directly, rather than storing raw labels plus `ownerCallerInfluenced`. Main's duplicate-subscription recorder registration remains intact and receives the same `inspectedOwnerLabel`; lane B's subscription/delivery inspection fields remain intact.

## `packages/snapback-client/index.d.mts`

6. **Inspection declarations.** This is a true union: main's full `SnapbackRuntimeCostDiagnosticsInspection` declaration is retained alongside lane B's ownership projection function, pending-delivery outcome/types, join function, mutation-phase declarations, and extended local-resource fields. The public ownership tuple uses lane B's redacted inspection shape, while main's runtime-cost diagnostics surface remains declared on `SnapbackLocalResourceInspection`.

## `packages/snapback-react/implementation.mjs`

7. **Provider owner-label options.** Main's `__frameworkOwnerLabel` call-site convention won. Lane B's `ownerLabel` plus `__ownerLabelFrameworkAssigned` pair was dropped; lane B's downstream inspection behavior now consumes the framework label through the single main convention.
