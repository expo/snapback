# Diagnostics registry scrapes environment-variable names

**Status:** Closed
**Date:** 2026-08-25
**Systems:** Diagnostics, Guide, Packaging
**Related:** LLP 0193, `scripts/generate-diagnostics-registry.mjs`,
`crates/snapback-kernel/src/live_matcher.rs`, canonical ticket
`issues/closed/20260823-diagnostics-registry-harvests-env-names.md`

## Symptom

The diagnostics registry treated every production `SNAPBACK_*` token as an
emitting site. That included the environment-variable read
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` in `live_matcher.rs`, even though
the diagnostic emitted by that branch is
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH`.

The environment-variable name consequently leaked into the generated registry,
Guide projection, and public `SnapbackDiagnosticCode` TypeScript union as if
it were a diagnostic code.

## Required fix

Classify source sites before adding them to the registry. Environment-variable
reads and unambiguous comparison/reference-only sites must not count as
emissions. Preserve explicit markers for syntax the classifier cannot prove,
and guard the classifier with fixtures that retain real emissions next to
excluded references.

## Resolution (2026-08-25, superseded by canonical ticket)

The final classifier separates emissions, received protocol vocabulary,
reservations, environment sites, and references. It bounds environment-name
tables by their matching nested/string-aware closing delimiter, so the exact
fail-first shape
`const SNAPBACK_ENVIRONMENT_NAMES = ['SNAPBACK_FOO_ENV']; throw new Error('SNAPBACK_REAL_FAILURE');`
retains the first token as an environment table entry and the second as a real
diagnostic.

The final round-16 correction binds environment-name tables to the opener
found for their declaration by the lexical delimiter stack. Comment braces,
string braces, and nested values before later entries are all regression
fixtures. Target discovery now includes `.sh`; shell-aware classification
retains 12 unique `deploy_fail` diagnostics from
`targets/cloudflare/deploy.sh` and separates `${SNAPBACK_X}`/`$SNAPBACK_X`
reads. Inline `#[cfg(test)]` modules and `#[test]` functions are excluded from
Rust production classification, leaving every `SNAPBACK_S3_TEST_*` name out
of `SnapbackEnvironmentVariable`. The affected-source selector covers `.sh`,
and the package-manifest rule is restricted to `packages/*/package.json`.

Generic environment-object mutations are classified before the read fallback:
the current `delete childEnv.SNAPBACK_CLIENT_RQS_DIR` site is a removal and
`delegatedEnvironment.SNAPBACK_ADMIN_TOKEN = …` is a write. The environment
object fixture also keeps entries after a `}` embedded in a string value inside
the same object.

Package manifests now contribute shipped `.swift` and `.kt` sources, and
the local-proof selection rule covers both extensions. Existing native custody
emitters are pinned to their real files:
`SNAPBACK_AUTH_CUSTODY_EXTENSION_IO_OCCURRED` in
`SnapbackExpoCustodyCore.swift` and
`SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_IO_OCCURRED` in
`SnapbackExpoCustodyModule.kt`.

Received-table detection recognizes `.has`, `.includes`, `.contains`,
`.binary_search`, and `is_code_member(..., NAME)` consumers. The four
error-tracking classifier tables now contribute received sites without hand
markers. `SNAPBACK_INVALID_FLOAT` remains received, and
`SNAPBACK_OPERATION_CANCELLED` is received through `CANCELLATION_CODES`;
neither is HTTP-table-only. The open deletion-review ticket therefore lists
seven genuine HTTP-only reservations, not nine.

`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the diagnostic registry
and `SnapbackDiagnosticCode`, but remains in the environment registry and
`SnapbackEnvironmentVariable`.

The canonical embedded measurement was rerun after the final implementation and
projection regeneration. Its captured output is:

```json
{
  "mergeBase": "e370bb8f789007cffae1f4d80c4feabdedc81cb5",
  "counts": {
    "codes": 3538,
    "sourceFiles": 642,
    "emittingSites": 9196,
    "receivedSites": 338,
    "reservedSites": 9,
    "httpClassified": 1709,
    "guideAnchored": 426,
    "environmentVariables": 191,
    "environmentSites": 390
  },
  "environmentKinds": {
    "read": 258,
    "mention": 56,
    "declaration": 14,
    "remove": 9,
    "write": 18,
    "table-entry": 20,
    "indirect-read": 15
  },
  "mergeBaseRemovals": {
    "total": 239,
    "environment": 141,
    "other": 98
  },
  "fixtureRawTokens": 87,
  "receivedCodes": 262,
  "httpReservations": 7,
  "cloudflareDeployEmissionCodes": 12,
  "s3TestEnvironmentNames": []
}
```

### Known JS/native lookup divergence

The generated registry and JavaScript Guide wrapper expose environment-only
and dual-role names, but the embedded Rust CLI/MCP lookup does not yet consult
the registry's `environment` section and mislabels received/reserved sites as
emissions. This closed ticket does not claim native parity; the exact Rust
change and parity tests are tracked in
`issues/20260825-native-guide-lookup-registry-kinds-parity.md`.
